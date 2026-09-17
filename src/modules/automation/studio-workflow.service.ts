import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { hostname } from 'os';
import { StudioExecution, StudioJob, StudioWorkflow } from './entities/studio-workflow.entity';
import { SaveStudioWorkflowDto } from './dto/studio-workflow.dto';
import { advanceStudioState, createStudioState, matchesStudioTrigger, runStudioDefinition } from './studio-runner';
import { StudioConnectionService } from './studio-connection.service';
import { validateStudioDefinition } from './studio-validation';
import { PLUGIN_MESSAGE_PORT, PluginMessagePort } from '../../core/plugins/plugin-host-ports';
import { createLogger } from '../../common/services/logger.service';
import { Session } from '../session/entities/session.entity';
import { StudioAiService } from './studio-ai.service';

const ACTIVE = ['queued', 'waiting', 'running'];
@Injectable()
export class StudioWorkflowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('AutomationStudio');
  private readonly owner = randomUUID();
  private readonly cooldowns = new Map<string, number>();
  private readonly hookRates = new Map<string, { until: number; count: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private tick?: Promise<void>;
  constructor(
    @InjectRepository(StudioWorkflow, 'data') private readonly workflows: Repository<StudioWorkflow>,
    @InjectRepository(StudioExecution, 'data') private readonly executions: Repository<StudioExecution>,
    @InjectRepository(StudioJob, 'data') private readonly jobs: Repository<StudioJob>,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly studioAi?: StudioAiService,
    @Optional() private readonly connections?: StudioConnectionService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.tick) return;
      this.tick = this.processDue()
        .catch(() => this.logger.warn('Workflow worker could not process pending runs'))
        .finally(() => {
          this.tick = undefined;
        });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.tick;
  }
  list(sessionId: string) {
    return this.workflows.find({ where: { sessionId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }
  async logs(sessionId: string) {
    const logs = await this.executions.find({ where: { sessionId }, order: { createdAt: 'DESC' }, take: 50 });
    const jobs = await this.jobs.find({
      where: { sessionId, status: In(ACTIVE) },
      select: { executionId: true, nextRunAt: true },
    });
    return logs.map(log => ({ ...log, nextRunAt: jobs.find(j => j.executionId === log.id)?.nextRunAt }));
  }
  async get(sessionId: string, id: string) {
    const workflow = await this.workflows.findOne({ where: { sessionId, id } });
    if (!workflow) throw new NotFoundException('Workflow not found');
    return workflow;
  }
  async save(sessionId: string, dto: SaveStudioWorkflowDto, id?: string) {
    try {
      validateStudioDefinition(dto.definition);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid workflow');
    }
    if (!dto.name.trim()) throw new BadRequestException('Workflow name is required.');
    if (!id && (await this.workflows.count({ where: { sessionId } })) >= 32)
      throw new BadRequestException('Maximum 32 workflows per session.');
    const workflow = id ? await this.get(sessionId, id) : this.workflows.create({ sessionId, webhookEnabled: false });
    const old = JSON.stringify(workflow.definition?.trigger);
    Object.assign(workflow, dto, { name: dto.name.trim() });
    if (dto.enabled && dto.definition.trigger?.type === 'schedule') {
      if (!workflow.nextScheduleAt || old !== JSON.stringify(dto.definition.trigger))
        workflow.nextScheduleAt = new Date(
          dto.definition.trigger.startAt || Date.now() + dto.definition.trigger.intervalMinutes! * 60000,
        ).toISOString();
    } else workflow.nextScheduleAt = null;
    const saved = await this.workflows.save(workflow);
    if (!saved.enabled) await this.cancelWorkflowJobs(saved.id, sessionId);
    return saved;
  }
  private async cancelWorkflowJobs(workflowId: string, sessionId: string) {
    await this.jobs.manager.transaction(async manager => {
      const pending = await manager.find(StudioJob, { where: { workflowId, sessionId, status: In(ACTIVE) } });
      if (!pending.length) return;
      await manager.update(
        StudioJob,
        { id: In(pending.map(j => j.id)) },
        { status: 'cancelled', state: null, definition: null, leaseOwner: null, leaseUntil: null },
      );
      await manager.update(
        StudioExecution,
        { id: In(pending.map(j => j.executionId)), sessionId },
        { status: 'cancelled' },
      );
    });
  }
  async remove(sessionId: string, id: string) {
    await this.get(sessionId, id);
    await this.cancelWorkflowJobs(id, sessionId);
    await this.workflows.delete({ sessionId, id });
  }
  async cancel(sessionId: string, executionId: string) {
    const job = await this.jobs.findOne({ where: { sessionId, executionId, status: In(ACTIVE) } });
    if (!job) throw new NotFoundException('Pending execution not found');
    await this.jobs.manager.transaction(async manager => {
      await manager.update(
        StudioJob,
        { id: job.id, sessionId, status: In(ACTIVE) },
        { status: 'cancelled', state: null, definition: null, leaseOwner: null, leaseUntil: null },
      );
      await manager.update(StudioExecution, { id: executionId, sessionId }, { status: 'cancelled' });
    });
  }
  async execute(
    workflow: StudioWorkflow,
    message: string,
    chatId: string,
    send?: (text: string) => Promise<unknown>,
    webhook?: unknown,
  ) {
    const result = await runStudioDefinition(
      workflow.definition,
      message,
      chatId,
      send,
      webhook,
      this.studioAi ? request => this.studioAi!.generate(workflow.sessionId, request) : undefined,
      this.connections ? (id, path) => this.connections!.request(workflow.sessionId, id, path) : undefined,
      this.connections ? (id, tool, args) => this.connections!.mcp(workflow.sessionId, id, tool, args) : undefined,
    );
    const log = await this.executions.save(
      this.executions.create({
        sessionId: workflow.sessionId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        test: !send,
        chatId: send ? chatId : null,
        status: result.status,
        trace: result.trace,
        durationMs: result.durationMs,
      }),
    );
    await this.prune(workflow.sessionId);
    return { ...result, id: log.id };
  }
  private async createJob(
    manager: EntityManager,
    workflow: StudioWorkflow,
    message: string,
    chatId: string,
    webhook?: unknown,
  ) {
    // Serialize the per-session capacity check on PostgreSQL; SQLite serializes writers.
    if (manager.connection.options.type === 'postgres')
      await manager.findOneOrFail(Session, { where: { id: workflow.sessionId }, lock: { mode: 'pessimistic_write' } });
    if ((await manager.count(StudioJob, { where: { sessionId: workflow.sessionId, status: In(ACTIVE) } })) >= 100)
      throw new BadRequestException('This session already has 100 pending runs.');
    const log = await manager.save(
      StudioExecution,
      manager.create(StudioExecution, {
        sessionId: workflow.sessionId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        test: false,
        chatId,
        status: 'queued',
        trace: [],
        durationMs: 0,
      }),
    );
    await manager.save(
      StudioJob,
      manager.create(StudioJob, {
        sessionId: workflow.sessionId,
        workflowId: workflow.id,
        executionId: log.id,
        chatId,
        definition: workflow.definition,
        state: createStudioState(message, chatId, webhook),
        status: 'queued',
        nextRunAt: new Date().toISOString(),
        leaseUntil: null,
        leaseOwner: null,
      }),
    );
    return { id: log.id, status: 'queued' };
  }
  enqueue(workflow: StudioWorkflow, message: string, chatId: string, webhook?: unknown) {
    return this.jobs.manager.transaction(manager => this.createJob(manager, workflow, message, chatId, webhook));
  }
  async inbound(sessionId: string, message: string, chatId: string) {
    for (const [key, until] of this.cooldowns) if (until < Date.now()) this.cooldowns.delete(key);
    for (const workflow of await this.list(sessionId)) {
      if (!workflow.enabled || !matchesStudioTrigger(workflow.definition, message, chatId)) continue;
      const key = `${workflow.id}:${chatId}`;
      if ((this.cooldowns.get(key) || 0) > Date.now()) return true;
      if (this.cooldowns.size >= 10000) return false;
      this.cooldowns.set(key, Date.now() + Math.max(10, workflow.definition.cooldownSeconds) * 1000);
      try {
        await this.enqueue(workflow, message, chatId);
      } catch (error) {
        this.cooldowns.delete(key);
        throw error;
      }
      return true;
    }
    return false;
  }
  async rotateWebhook(sessionId: string, id: string) {
    const workflow = await this.get(sessionId, id);
    if (workflow.definition.trigger?.type !== 'webhook')
      throw new BadRequestException('Choose the webhook trigger first.');
    const token = randomBytes(32).toString('hex');
    await this.workflows.update(
      { id, sessionId },
      { webhookTokenHash: createHash('sha256').update(token).digest('hex'), webhookEnabled: true },
    );
    return { token, path: `/api/studio-hooks/${id}`, header: 'X-Workflow-Token' };
  }
  async receiveWebhook(id: string, token: string, payload: unknown) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw new UnauthorizedException('Invalid workflow token');
    const workflow = await this.workflows
      .createQueryBuilder('workflow')
      .addSelect('workflow.webhookTokenHash')
      .where('workflow.id = :id', { id })
      .getOne();
    const digest = createHash('sha256').update(token).digest('hex');
    if (!workflow?.webhookTokenHash || !timingSafeEqual(Buffer.from(digest), Buffer.from(workflow.webhookTokenHash)))
      throw new UnauthorizedException('Invalid workflow token');
    if (!workflow.enabled || workflow.definition.trigger?.type !== 'webhook' || !workflow.webhookEnabled)
      throw new BadRequestException('Webhook workflow is paused');
    if (Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8') > 65536)
      throw new BadRequestException('Webhook payload exceeds 64 KB');
    for (const [key, rate] of this.hookRates) if (rate.until < Date.now()) this.hookRates.delete(key);
    const rate = this.hookRates.get(id) || { until: Date.now() + 60000, count: 0 };
    if (++rate.count > 60) throw new BadRequestException('Webhook rate limit reached. Try again next minute.');
    this.hookRates.set(id, rate);
    return this.enqueue(workflow, '', workflow.definition.trigger.chatId!, payload);
  }
  async processDue(sendOverride?: (sessionId: string, chatId: string, text: string) => Promise<unknown>) {
    const now = new Date().toISOString();
    const dueSchedules = await this.workflows
      .createQueryBuilder('workflow')
      .where('workflow.enabled = :enabled AND workflow.nextScheduleAt <= :now', { enabled: true, now })
      .take(5)
      .getMany();
    for (const workflow of dueSchedules) {
      const trigger = workflow.definition.trigger;
      if (trigger?.type !== 'schedule') continue;
      try {
        await this.jobs.manager.transaction(async manager => {
          const claim = await manager.update(
            StudioWorkflow,
            { id: workflow.id, enabled: true, nextScheduleAt: workflow.nextScheduleAt },
            { nextScheduleAt: new Date(Date.now() + trigger.intervalMinutes! * 60000).toISOString() },
          );
          if (claim.affected) await this.createJob(manager, workflow, '', trigger.chatId!);
        });
      } catch {
        this.logger.warn('Scheduled workflow could not be queued');
      }
    }
    const pending = await this.jobs
      .createQueryBuilder('job')
      .innerJoin('sessions', 'session', 'session.id = job.sessionId')
      .where(
        '((job.status IN (:...ready) AND job.nextRunAt <= :now) OR (job.status = :running AND job.leaseUntil <= :now))',
        { ready: ['queued', 'waiting'], running: 'running', now },
      )
      .andWhere('(session.nodeId IS NULL OR session.nodeId = :nodeId OR session.leaseExpiresAt < :now)', {
        nodeId: process.env.NODE_ID || hostname(),
        now,
      })
      .orderBy('job.nextRunAt', 'ASC')
      .take(5)
      .getMany();
    for (const job of pending) {
      const lease = new Date(Date.now() + 120000).toISOString();
      const claimed = await this.jobs
        .createQueryBuilder()
        .update()
        .set({ status: 'running', leaseUntil: lease, leaseOwner: this.owner })
        .where(
          'id = :id AND ((status IN (:...ready) AND nextRunAt <= :now) OR (status = :running AND leaseUntil <= :now))',
          { id: job.id, ready: ['queued', 'waiting'], running: 'running', now },
        )
        .execute();
      if (!claimed.affected) continue;
      try {
        const current = await this.workflows.findOne({
          where: { id: job.workflowId, sessionId: job.sessionId, enabled: true },
        });
        if (!current || !job.definition || !job.state) {
          await this.cancelWorkflowJobs(job.workflowId, job.sessionId);
          continue;
        }
        const state = job.state;
        const send = async (text: string) => {
          if (sendOverride) return sendOverride(job.sessionId, job.chatId, text);
          const port = this.moduleRef?.get<PluginMessagePort>(PLUGIN_MESSAGE_PORT, { strict: false });
          if (!port) throw new Error('WhatsApp sending service is unavailable.');
          return port.sendText(job.sessionId, { chatId: job.chatId, text });
        };
        const started = Date.now();
        const result = await advanceStudioState(job.definition, state, {
          send,
          ai: this.studioAi ? request => this.studioAi!.generate(job.sessionId, request) : undefined,
          connection: this.connections ? (id, path) => this.connections!.request(job.sessionId, id, path) : undefined,
          mcp: this.connections ? (id, tool, args) => this.connections!.mcp(job.sessionId, id, tool, args) : undefined,
          beforeSend: async () => {
            const checkpoint = await this.jobs.update(
              { id: job.id, status: 'running', leaseOwner: this.owner },
              { state: state as unknown as QueryDeepPartialEntity<StudioJob>['state'] },
            );
            if (!checkpoint.affected) throw new Error('Execution was cancelled before sending.');
          },
        });
        const active = result.status === 'running' || result.status === 'waiting';
        await this.jobs.manager.transaction(async manager => {
          // simple-json is a scalar database column, despite TypeORM's recursive partial type.
          const saved = await manager.update(
            StudioJob,
            { id: job.id, status: 'running', leaseOwner: this.owner },
            {
              status: active ? (result.status === 'waiting' ? 'waiting' : 'queued') : result.status,
              state: (active ? state : null) as unknown as QueryDeepPartialEntity<StudioJob>['state'],
              definition: active ? job.definition : null,
              nextRunAt: new Date(Date.now() + (result.waitMs || 0)).toISOString(),
              leaseOwner: null,
              leaseUntil: null,
            },
          );
          if (!saved.affected) return;
          const log = await manager.findOneByOrFail(StudioExecution, { id: job.executionId, sessionId: job.sessionId });
          await manager.update(
            StudioExecution,
            { id: log.id },
            {
              status: result.status === 'running' ? 'queued' : result.status,
              trace: state.trace,
              durationMs: log.durationMs + Date.now() - started,
            },
          );
        });
        if (!active) await this.prune(job.sessionId);
      } catch {
        // Persisted checkpoint remains recoverable after lease expiration.
        this.logger.warn('Workflow checkpoint could not be persisted');
      }
    }
  }
  private async prune(sessionId: string) {
    const old = await this.executions.find({
      where: { sessionId, status: In(['success', 'failed', 'stopped', 'cancelled']) },
      order: { createdAt: 'DESC' },
      skip: 200,
      take: 100,
      select: { id: true },
    });
    if (old.length) {
      const ids = old.map(j => j.id);
      await this.jobs.delete({ sessionId, executionId: In(ids) });
      await this.executions.delete(ids);
    }
  }
}

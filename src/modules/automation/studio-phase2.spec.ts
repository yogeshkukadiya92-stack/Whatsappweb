import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Session } from '../session/entities/session.entity';
import {
  StudioDefinition,
  StudioExecution,
  StudioJob,
  StudioStep,
  StudioWorkflow,
} from './entities/studio-workflow.entity';
import { StudioWorkflowService } from './studio-workflow.service';
import { advanceStudioState, createStudioState, runStudioDefinition } from './studio-runner';
import { validateStudioDefinition } from './studio-validation';
import { SaveStudioWorkflowDto } from './dto/studio-workflow.dto';
import { withSafeFetch } from '../../common/security/ssrf-guard';
import { AddAutomationStudio1786800000000 } from '../../database/migrations/1786800000000-AddAutomationStudio';
import { AddStudioDurableJobs1786900000000 } from '../../database/migrations/1786900000000-AddStudioDurableJobs';
jest.mock('../../common/security/ssrf-guard', () => ({
  ...jest.requireActual<typeof import('../../common/security/ssrf-guard')>('../../common/security/ssrf-guard'),
  withSafeFetch: jest.fn(),
}));
const definition = (steps: StudioStep[], trigger?: StudioDefinition['trigger']): StudioDefinition => ({
  keywords: ['hello'],
  audience: 'direct',
  cooldownSeconds: 60,
  steps,
  trigger,
});
const reply = (id = 'reply', text = 'Hello'): StudioStep => ({ id, type: 'reply', label: id, config: { text } });
const list = (): StudioStep[] => [
  {
    id: 'loop',
    type: 'iterator',
    label: 'Items',
    config: { array: '[{"name":"A"},{"name":"B"}]', alias: 'item', end: 'collect' },
  },
  {
    id: 'transform',
    type: 'variable',
    label: 'Transform',
    config: { name: 'title', value: '{{index}}: {{item.name}}' },
  },
  {
    id: 'collect',
    type: 'aggregator',
    label: 'Collect',
    config: { output: 'summary', value: '{{title}}', separator: ', ' },
  },
  reply('reply', '{{summary}}'),
];
describe('Phase 2 graph and checkpoint runner', () => {
  it('takes only the first matching router path and skips alternative branches', async () => {
    const steps: StudioStep[] = [
      {
        id: 'route',
        type: 'router',
        label: 'Route',
        config: {
          routes: JSON.stringify([
            { label: 'Sales', value: '{{message}}', operator: 'contains', expected: 'buy', target: 'sales' },
          ]),
          fallback: 'support',
        },
      },
      { ...reply('sales', 'Sales'), config: { text: 'Sales', next: 'end' } },
      reply('support', 'Support'),
    ];
    validateStudioDefinition(definition(steps));
    expect((await runStudioDefinition(definition(steps), 'buy now', '1@c.us')).replies).toEqual(['Sales']);
    expect((await runStudioDefinition(definition(steps), 'help', '1@c.us')).replies).toEqual(['Support']);
  });
  it('iterates and aggregates mapped values, including empty arrays', async () => {
    const steps = list();
    validateStudioDefinition(definition(steps));
    expect((await runStudioDefinition(definition(steps), '', '1@c.us')).replies).toEqual(['0: A, 1: B']);
    steps[0].config.array = '[]';
    steps[3].config.text = 'Result: {{summary}}';
    expect((await runStudioDefinition(definition(steps), '', '1@c.us')).replies).toEqual(['Result: ']);
  });
  it('restores nested iterator aliases and parent indexes', async () => {
    const steps: StudioStep[] = [
      {
        id: 'outer',
        type: 'iterator',
        label: 'Outer',
        config: { array: '[[1,2],[3]]', alias: 'item', end: 'outerEnd' },
      },
      { id: 'inner', type: 'iterator', label: 'Inner', config: { array: '{{item}}', alias: 'item', end: 'innerEnd' } },
      {
        id: 'innerEnd',
        type: 'aggregator',
        label: 'Inner result',
        config: { value: '{{item}}', output: 'innerResult', separator: '-' },
      },
      {
        id: 'outerEnd',
        type: 'aggregator',
        label: 'Outer result',
        config: { value: '{{index}}:{{innerResult}}', output: 'result', separator: ',' },
      },
      reply('r', '{{result}}'),
    ];
    validateStudioDefinition(definition(steps));
    expect((await runStudioDefinition(definition(steps), '', '1@c.us')).replies).toEqual(['0:1-2,1:3']);
  });
  it('rejects backward edges, dangling aggregators, loop escapes and jumps into loop bodies', () => {
    expect(() => validateStudioDefinition(definition([{ ...reply(), config: { text: 'x', next: 'reply' } }]))).toThrow(
      'later step',
    );
    const steps = list();
    steps[1].config.next = 'end';
    expect(() => validateStudioDefinition(definition(steps))).toThrow('inside an iterator');
    steps[1].config.next = '';
    expect(() =>
      validateStudioDefinition(definition([{ ...reply('before'), config: { text: 'x', next: 'collect' } }, ...steps])),
    ).toThrow('starting step');
    expect(() => validateStudioDefinition(definition([steps[2]]))).toThrow('finish an iterator');
  });
  it('retries API errors with checkpointed exponential backoff, then resumes', async () => {
    const d = definition([
      {
        id: 'api',
        type: 'http',
        label: 'API',
        config: { method: 'GET', url: 'https://example.com', output: 'data', retries: '2', backoffSeconds: '3' },
      },
      reply('r', '{{data.title}}'),
    ]);
    const state = createStudioState('', '1@c.us');
    (withSafeFetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockImplementationOnce((_url: string, _init: unknown, use: (response: Response) => Promise<unknown>) =>
        use(new Response('{"title":"Ready"}')),
      );
    expect(await advanceStudioState(d, state)).toEqual({ status: 'waiting', waitMs: 3000 });
    expect(state.cursor).toBe(0);
    expect(await advanceStudioState(d, state)).toEqual({ status: 'waiting', waitMs: 6000 });
    expect((await advanceStudioState(d, state)).status).toBe('running');
    expect((await advanceStudioState(d, state)).status).toBe('success');
    expect(state.replies).toEqual(['Ready']);
  });
  it('routes handled failures to an error reply but never bypasses safety limits', async () => {
    const d = definition([
      {
        id: 'bad',
        type: 'variable',
        label: 'Bad',
        config: { name: 'x', value: '{{missing}}', onError: 'route', errorTarget: 'handler' },
      },
      reply('skipped', 'Wrong'),
      reply('handler', 'Error: {{error}}'),
    ]);
    expect((await runStudioDefinition(d, '', '1@c.us')).replies[0]).toContain('not available');
    const state = createStudioState('', '1@c.us');
    state.operations = 500;
    expect((await advanceStudioState(d, state)).status).toBe('failed');
  });
  it('does not replay an interrupted WhatsApp send', async () => {
    const state = createStudioState('', '1@c.us');
    state.sending = true;
    const send = jest.fn();
    expect((await advanceStudioState(definition([reply()]), state, { send })).status).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });
  it('validates nested trigger DTOs and requires an explicit external recipient', async () => {
    const dto = plainToInstance(SaveStudioWorkflowDto, {
      name: 'Schedule',
      enabled: false,
      definition: definition([reply()], { type: 'schedule', intervalMinutes: 0 }),
    });
    expect(await validate(dto)).not.toHaveLength(0);
    expect(() => validateStudioDefinition(dto.definition)).toThrow('destination');
  });
});
describe('Phase 2 durable service on SQLite', () => {
  let db: DataSource;
  let studio: StudioWorkflowService;
  let session: Session;
  const service = () =>
    new StudioWorkflowService(
      db.getRepository(StudioWorkflow),
      db.getRepository(StudioExecution),
      db.getRepository(StudioJob),
    );
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, StudioWorkflow, StudioExecution, StudioJob],
      synchronize: true,
    }).initialize();
    session = await db.getRepository(Session).save({ name: 'QA', status: 'ready' });
    studio = service();
  });
  afterEach(async () => {
    await db.destroy();
  });
  it('runs persisted jobs against migration-built Studio tables without synchronize', async () => {
    const q = db.createQueryRunner();
    try {
      await q.query('DROP TABLE studio_jobs');
      await q.query('DROP TABLE studio_executions');
      await q.query('DROP TABLE studio_workflows');
      await new AddAutomationStudio1786800000000().up(q);
      await new AddStudioDurableJobs1786900000000().up(q);
      const workflow = await studio.save(session.id, {
        name: 'Migrated',
        enabled: true,
        definition: definition([reply()]),
      });
      await studio.enqueue(workflow, '', '1@c.us');
      const send = jest.fn();
      await studio.processDue(send);
      expect(send).toHaveBeenCalledTimes(1);
      expect((await studio.logs(session.id))[0].status).toBe('success');
    } finally {
      await q.release();
    }
  });
  it('queues inbound messages, respects cooldown, and resumes a delay in a new worker instance', async () => {
    const workflow = await studio.save(session.id, {
      name: 'Wait',
      enabled: true,
      definition: definition([{ id: 'wait', type: 'delay', label: 'Wait', config: { seconds: '60' } }, reply()]),
    });
    expect(await studio.inbound(session.id, 'hello', '1@c.us')).toBe(true);
    await studio.inbound(session.id, 'hello', '1@c.us');
    expect(await db.getRepository(StudioJob).count()).toBe(1);
    const send = jest.fn();
    await studio.processDue(send);
    expect((await studio.logs(session.id))[0].status).toBe('waiting');
    expect(send).not.toHaveBeenCalled();
    await service().processDue(send);
    expect(send).not.toHaveBeenCalled();
    await db.getRepository(StudioJob).update({ workflowId: workflow.id }, { nextRunAt: '2000-01-01T00:00:00.000Z' });
    await service().processDue(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await studio.logs(session.id))[0].status).toBe('success');
    expect((await db.getRepository(StudioJob).find())[0].state).toBeNull();
  });
  it('claims a job once while another worker is processing it', async () => {
    const workflow = await studio.save(session.id, { name: 'Send', enabled: true, definition: definition([reply()]) });
    await studio.enqueue(workflow, '', '1@c.us');
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const sending = new Promise<void>(resolve => {
      entered = resolve;
    });
    const send = jest.fn(async () => {
      entered();
      await barrier;
    });
    const first = studio.processDue(send);
    await sending;
    await service().processDue(send);
    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('recovers expired leases and stops uncertain sends instead of replaying', async () => {
    const workflow = await studio.save(session.id, { name: 'Send', enabled: true, definition: definition([reply()]) });
    await studio.enqueue(workflow, '', '1@c.us');
    const job = (await db.getRepository(StudioJob).find())[0];
    job.state!.sending = true;
    job.status = 'running';
    job.leaseUntil = '2000-01-01T00:00:00.000Z';
    job.leaseOwner = 'old-worker';
    await db.getRepository(StudioJob).save(job);
    const send = jest.fn();
    await service().processDue(send);
    expect(send).not.toHaveBeenCalled();
    expect((await studio.logs(session.id))[0].status).toBe('failed');
  });
  it('coalesces a missed schedule into one run and advances its next time', async () => {
    const workflow = await studio.save(session.id, {
      name: 'Schedule',
      enabled: true,
      definition: definition([reply()], {
        type: 'schedule',
        chatId: '123@c.us',
        intervalMinutes: 60,
        startAt: '2000-01-01T00:00:00Z',
      }),
    });
    const send = jest.fn();
    await studio.processDue(send);
    await service().processDue(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(session.id, '123@c.us', 'Hello');
    expect(Date.parse((await studio.get(session.id, workflow.id)).nextScheduleAt!)).toBeGreaterThan(Date.now());
  });
  it('authenticates webhook tokens, revokes old tokens, isolates recipients and hides hashes', async () => {
    const workflow = await studio.save(session.id, {
      name: 'Hook',
      enabled: true,
      definition: definition([reply('r', 'Hello {{webhook.name}}')], { type: 'webhook', chatId: '123@c.us' }),
    });
    const secret = await studio.rotateWebhook(session.id, workflow.id);
    await expect(studio.receiveWebhook(workflow.id, '0'.repeat(64), {})).rejects.toThrow('Invalid workflow token');
    await studio.receiveWebhook(workflow.id, secret.token, { name: 'Yogesh', chatId: '999@c.us' });
    const send = jest.fn();
    await studio.processDue(send);
    expect(send).toHaveBeenCalledWith(session.id, '123@c.us', 'Hello Yogesh');
    expect((await studio.list(session.id))[0].webhookTokenHash).toBeUndefined();
    const rotated = await studio.rotateWebhook(session.id, workflow.id);
    await expect(studio.receiveWebhook(workflow.id, secret.token, {})).rejects.toThrow('Invalid workflow token');
    await expect(studio.receiveWebhook(workflow.id, rotated.token, { text: 'x'.repeat(65537) })).rejects.toThrow(
      '64 KB',
    );
  });
  it('cancels pending runs individually and when a workflow is paused', async () => {
    const workflow = await studio.save(session.id, { name: 'Wait', enabled: true, definition: definition([reply()]) });
    const queued = await studio.enqueue(workflow, '', '1@c.us');
    await studio.cancel(session.id, queued.id);
    expect((await studio.logs(session.id))[0].status).toBe('cancelled');
    await studio.enqueue(workflow, '', '1@c.us');
    await studio.save(
      session.id,
      { name: workflow.name, enabled: false, definition: workflow.definition },
      workflow.id,
    );
    const send = jest.fn();
    await studio.processDue(send);
    expect(send).not.toHaveBeenCalled();
    expect(
      (await db.getRepository(StudioJob).find()).every(job => job.state === null && job.status === 'cancelled'),
    ).toBe(true);
  });
});
describe('Phase 2 database migration', () => {
  it('upgrades SQLite idempotently and reverts only Phase 2 tables and columns', async () => {
    const db = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    const q = db.createQueryRunner();
    try {
      await q.query('CREATE TABLE sessions (id varchar PRIMARY KEY)');
      await new AddAutomationStudio1786800000000().up(q);
      const migration = new AddStudioDurableJobs1786900000000();
      await migration.up(q);
      await migration.up(q);
      expect(await q.hasTable('studio_jobs')).toBe(true);
      expect((await q.getTable('studio_workflows'))?.findColumnByName('nextScheduleAt')).toBeDefined();
      await migration.down(q);
      expect(await q.hasTable('studio_jobs')).toBe(false);
      expect(await q.hasTable('studio_workflows')).toBe(true);
    } finally {
      await q.release();
      await db.destroy();
    }
  });
});

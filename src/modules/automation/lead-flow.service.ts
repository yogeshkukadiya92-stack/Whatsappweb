import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadFlow } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { CreateLeadFlowDto, UpdateLeadFlowDto } from './dto/lead-flow.dto';
import { createLogger } from '../../common/services/logger.service';

@Injectable()
export class LeadFlowService {
  private readonly logger = createLogger('LeadFlowService');

  constructor(
    @InjectRepository(LeadFlow, 'data')
    private readonly flowRepository: Repository<LeadFlow>,
    @InjectRepository(LeadEntry, 'data')
    private readonly entryRepository: Repository<LeadEntry>,
  ) {}

  // --- Flow Definitions ---

  async createFlow(sessionId: string, dto: CreateLeadFlowDto): Promise<LeadFlow> {
    const flow = this.flowRepository.create({
      sessionId,
      name: dto.name,
      triggers: dto.triggers || [],
      steps: dto.steps || [],
      completionMessage: dto.completionMessage,
      enabled: dto.enabled ?? true,
    });
    return this.flowRepository.save(flow);
  }

  async findAllFlows(sessionId: string): Promise<LeadFlow[]> {
    return this.flowRepository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneFlow(sessionId: string, id: string): Promise<LeadFlow> {
    const flow = await this.flowRepository.findOne({ where: { id, sessionId } });
    if (!flow) {
      throw new NotFoundException(`Lead flow ${id} not found`);
    }
    return flow;
  }

  async updateFlow(sessionId: string, id: string, dto: UpdateLeadFlowDto): Promise<LeadFlow> {
    const flow = await this.findOneFlow(sessionId, id);
    if (dto.name !== undefined) flow.name = dto.name;
    if (dto.triggers !== undefined) flow.triggers = dto.triggers;
    if (dto.steps !== undefined) flow.steps = dto.steps;
    if (dto.completionMessage !== undefined) flow.completionMessage = dto.completionMessage;
    if (dto.enabled !== undefined) flow.enabled = dto.enabled;
    return this.flowRepository.save(flow);
  }

  async removeFlow(sessionId: string, id: string): Promise<void> {
    const flow = await this.findOneFlow(sessionId, id);
    await this.flowRepository.remove(flow);
  }

  // --- Captured Leads ---

  async findAllLeads(sessionId: string): Promise<LeadEntry[]> {
    return this.entryRepository.find({
      where: { sessionId },
      order: { updatedAt: 'DESC' },
    });
  }

  async removeLead(sessionId: string, id: string): Promise<void> {
    const lead = await this.entryRepository.findOne({ where: { id, sessionId } });
    if (lead) {
      await this.entryRepository.remove(lead);
    }
  }

  async exportLeadsCsv(sessionId: string): Promise<string> {
    const leads = await this.findAllLeads(sessionId);
    if (leads.length === 0) {
      return 'ID,Chat ID,Status,Created At,Data\n';
    }

    // Collect all unique keys from collectedData
    const allKeys = new Set<string>();
    for (const lead of leads) {
      if (lead.collectedData) {
        for (const k of Object.keys(lead.collectedData)) {
          allKeys.add(k);
        }
      }
    }
    const keyList = Array.from(allKeys);

    const headers = ['Chat ID', 'Status', 'Date', ...keyList];
    const rows = leads.map(lead => {
      const dateStr = lead.createdAt ? new Date(lead.createdAt).toISOString() : '';
      const dataValues = keyList.map(k => `"${(lead.collectedData?.[k] || '').replace(/"/g, '""')}"`);
      return [`"${lead.chatId}"`, `"${lead.status}"`, `"${dateStr}"`, ...dataValues].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  // --- Inbound Conversation Progression ---

  async handleInbound(
    sessionId: string,
    chatId: string,
    text: string,
  ): Promise<{ handled: boolean; replyText?: string }> {
    const normalizedText = text.trim();

    // 1. Check for active (in_progress) lead flow
    const activeEntry = await this.entryRepository.findOne({
      where: { sessionId, chatId, status: 'in_progress' },
      order: { updatedAt: 'DESC' },
    });

    if (activeEntry && activeEntry.flowId) {
      const flow = await this.flowRepository.findOne({ where: { id: activeEntry.flowId, sessionId } });
      if (flow && flow.steps && flow.steps.length > 0) {
        const currentStep = flow.steps[activeEntry.currentStepIndex];
        const data = activeEntry.collectedData || {};

        if (currentStep) {
          data[currentStep.key] = normalizedText;
          activeEntry.collectedData = data;
          activeEntry.currentStepIndex += 1;
        }

        if (activeEntry.currentStepIndex >= flow.steps.length) {
          // Completed!
          activeEntry.status = 'completed';
          await this.entryRepository.save(activeEntry);

          let reply = flow.completionMessage || 'Thank you! We have received your details.';
          for (const [k, v] of Object.entries(data)) {
            reply = reply.replace(new RegExp(`{{${k}}}`, 'g'), v);
          }
          return { handled: true, replyText: reply };
        } else {
          // Advance to next step
          await this.entryRepository.save(activeEntry);
          const nextQuestion = flow.steps[activeEntry.currentStepIndex]?.question || 'Please provide more details:';
          return { handled: true, replyText: nextQuestion };
        }
      }
    }

    // 2. Not currently in a flow — check if text triggers a new LeadFlow
    const flows = await this.flowRepository.find({ where: { sessionId, enabled: true } });
    const lowerText = normalizedText.toLowerCase();

    for (const flow of flows) {
      const matchesTrigger = (flow.triggers || []).some(t => {
        const trig = t.trim().toLowerCase();
        return lowerText === trig || lowerText.startsWith(trig) || lowerText.includes(trig);
      });

      if (matchesTrigger && flow.steps && flow.steps.length > 0) {
        // Reset any existing in-progress entries for this chat
        await this.entryRepository.delete({ sessionId, chatId, status: 'in_progress' });

        const newEntry = this.entryRepository.create({
          sessionId,
          chatId,
          flowId: flow.id,
          currentStepIndex: 0,
          status: 'in_progress',
          collectedData: {},
        });
        await this.entryRepository.save(newEntry);

        const firstQuestion = flow.steps[0].question;
        return { handled: true, replyText: firstQuestion };
      }
    }

    return { handled: false };
  }
}

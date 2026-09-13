import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadFlow, LeadFlowStep } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { CreateLeadFlowDto, UpdateLeadFlowDto } from './dto/lead-flow.dto';
import { createLogger } from '../../common/services/logger.service';

export function parseSteps(steps: any): LeadFlowStep[] {
  if (typeof steps === 'string') {
    try {
      steps = JSON.parse(steps);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s, idx) => {
      if (typeof s === 'string') {
        try {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed === 'object') {
            return {
              key: String(parsed.key || `step_${idx + 1}`),
              question: String(parsed.question || parsed.prompt || parsed.text || s),
              options: Array.isArray(parsed.options)
                ? parsed.options.map((option: unknown) => String(option).trim()).filter(Boolean)
                : undefined,
            };
          }
        } catch {
          return { key: `step_${idx + 1}`, question: s };
        }
      }
      if (s && typeof s === 'object') {
        return {
          key: String(s.key || s.field || s.id || `step_${idx + 1}`),
          question: String(s.question || s.prompt || s.text || ''),
          options: Array.isArray(s.options)
            ? s.options.map((option: unknown) => String(option).trim()).filter(Boolean)
            : undefined,
        };
      }
      return { key: `step_${idx + 1}`, question: String(s || '') };
    })
    .filter(s => s.question.trim().length > 0);
}

export function parseTriggers(triggers: any): string[] {
  if (typeof triggers === 'string') {
    try {
      triggers = JSON.parse(triggers);
    } catch {
      triggers = triggers.split(',').map((t: string) => t.trim());
    }
  }
  if (!Array.isArray(triggers)) return [];
  return triggers
    .map(t => String(t || '').trim())
    .filter(Boolean);
}

export function parseCollectedData(data: any): Record<string, string> {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' ? data : {};
}

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
    let targetSessionId = sessionId;
    if (targetSessionId === 'all') {
      try {
        const rows: any = await this.flowRepository.query('SELECT id FROM sessions LIMIT 1');
        if (rows && rows.length > 0 && rows[0].id) {
          targetSessionId = rows[0].id;
        }
      } catch {
        // fallback to provided sessionId if query fails
      }
    }

    const flow = this.flowRepository.create({
      sessionId: targetSessionId,
      name: dto.name,
      triggers: parseTriggers(dto.triggers),
      steps: parseSteps(dto.steps),
      completionMessage: dto.completionMessage,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.flowRepository.save(flow);
    return {
      ...saved,
      triggers: parseTriggers(saved.triggers),
      steps: parseSteps(saved.steps),
    };
  }

  async findAllFlows(sessionId: string): Promise<LeadFlow[]> {
    const whereClause = sessionId && sessionId !== 'all' ? { sessionId } : {};
    const flows = await this.flowRepository.find({
      where: whereClause,
      order: { createdAt: 'DESC' },
    });
    return flows.map(flow => ({
      ...flow,
      triggers: parseTriggers(flow.triggers),
      steps: parseSteps(flow.steps),
    }));
  }

  async findOneFlow(sessionId: string, id: string): Promise<LeadFlow> {
    const whereClause = sessionId && sessionId !== 'all' ? { id, sessionId } : { id };
    const flow = await this.flowRepository.findOne({ where: whereClause });
    if (!flow) {
      throw new NotFoundException(`Lead flow ${id} not found`);
    }
    return {
      ...flow,
      triggers: parseTriggers(flow.triggers),
      steps: parseSteps(flow.steps),
    };
  }

  async updateFlow(sessionId: string, id: string, dto: UpdateLeadFlowDto): Promise<LeadFlow> {
    const flow = await this.findOneFlow(sessionId, id);
    if (dto.name !== undefined) flow.name = dto.name;
    if (dto.triggers !== undefined) flow.triggers = parseTriggers(dto.triggers);
    if (dto.steps !== undefined) flow.steps = parseSteps(dto.steps);
    if (dto.completionMessage !== undefined) flow.completionMessage = dto.completionMessage;
    if (dto.enabled !== undefined) flow.enabled = dto.enabled;
    const saved = await this.flowRepository.save(flow);
    return {
      ...saved,
      triggers: parseTriggers(saved.triggers),
      steps: parseSteps(saved.steps),
    };
  }

  async removeFlow(sessionId: string, id: string): Promise<void> {
    const flow = await this.findOneFlow(sessionId, id);
    await this.flowRepository.remove(flow);
  }

  // --- Captured Leads ---

  async findAllLeads(sessionId: string): Promise<LeadEntry[]> {
    const whereClause = sessionId && sessionId !== 'all' ? { sessionId } : {};
    const leads = await this.entryRepository.find({
      where: whereClause,
      order: { updatedAt: 'DESC' },
    });
    return leads.map(lead => ({
      ...lead,
      collectedData: parseCollectedData(lead.collectedData),
    }));
  }

  async removeLead(sessionId: string, id: string): Promise<void> {
    const whereClause = sessionId && sessionId !== 'all' ? { id, sessionId } : { id };
    const lead = await this.entryRepository.findOne({ where: whereClause });
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
  ): Promise<{ handled: boolean; replyText?: string; replyOptions?: string[] }> {
    const normalizedText = text.trim();
    if (!normalizedText) return { handled: false };
    const lowerText = normalizedText.toLowerCase();

    // 1. Check for active (in_progress) lead flow for this session & chat, with global chat fallback
    let activeEntry = await this.entryRepository.findOne({
      where: { sessionId, chatId, status: 'in_progress' },
      order: { updatedAt: 'DESC' },
    });
    if (!activeEntry) {
      activeEntry = await this.entryRepository.findOne({
        where: { chatId, status: 'in_progress' },
        order: { updatedAt: 'DESC' },
      });
    }

    if (activeEntry && activeEntry.flowId) {
      const flow = await this.flowRepository.findOne({ where: { id: activeEntry.flowId } });
      const steps = flow ? parseSteps(flow.steps) : [];

      if (flow && steps.length > 0) {
        // User cancellation keywords
        if (['cancel', 'stop', 'exit', 'રદ કરો', 'બંધ કરો', 'quit'].includes(lowerText)) {
          await this.entryRepository.delete({ id: activeEntry.id });
          this.logger.log('Lead flow cancelled by user', { sessionId, chatId });
          return { handled: true, replyText: 'ચેટ પ્રક્રિયા રદ કરવામાં આવી છે. (Questionnaire cancelled)' };
        }

        const currentStep = steps[activeEntry.currentStepIndex];
        const data = parseCollectedData(activeEntry.collectedData);

        if (currentStep) {
          data[currentStep.key] = normalizedText;
          activeEntry.collectedData = data;
          activeEntry.currentStepIndex += 1;
        }

        if (activeEntry.currentStepIndex >= steps.length) {
          // Completed!
          activeEntry.status = 'completed';
          await this.entryRepository.save(activeEntry);

          let reply = flow.completionMessage || 'આભાર! તમારી વિગતો નોંધી લેવામાં આવી છે. અમારી ટીમ ટૂંક સમયમાં તમારો સંપર્ક કરશે. 🙏';
          for (const [k, v] of Object.entries(data)) {
            reply = reply.replace(new RegExp(`{{${k}}}`, 'g'), v);
          }
          this.logger.log('Lead flow completed successfully', { sessionId, chatId });
          return { handled: true, replyText: reply };
        } else {
          // Advance to next step
          await this.entryRepository.save(activeEntry);
          const nextStep = steps[activeEntry.currentStepIndex];
          const nextQuestion = nextStep?.question || 'કૃપા કરીને આગળની વિગત આપો:';
          this.logger.log('Lead flow advanced to step', { sessionId, chatId, stepIndex: activeEntry.currentStepIndex });
          return { handled: true, replyText: nextQuestion, replyOptions: nextStep?.options };
        }
      }
    }

    // 2. Not currently in a flow — check if text triggers a new LeadFlow
    // Prioritize session-specific enabled flows, then fall back to all enabled global flows
    const sessionFlows = await this.flowRepository.find({ where: { sessionId, enabled: true } });
    const globalFlows = await this.flowRepository.find({ where: { enabled: true } });

    const flowMap = new Map<string, LeadFlow>();
    for (const f of sessionFlows) flowMap.set(f.id, f);
    for (const f of globalFlows) {
      if (!flowMap.has(f.id)) flowMap.set(f.id, f);
    }
    const candidateFlows = Array.from(flowMap.values());

    for (const rawFlow of candidateFlows) {
      const triggers = parseTriggers(rawFlow.triggers);
      const steps = parseSteps(rawFlow.steps);

      const matchesTrigger = triggers.some(t => {
        const trig = t.trim().toLowerCase();
        return trig.length > 0 && (lowerText === trig || lowerText.startsWith(trig) || lowerText.includes(trig));
      });

      if (matchesTrigger && steps.length > 0) {
        // Reset any existing in-progress entries for this chat
        await this.entryRepository.delete({ chatId, status: 'in_progress' });

        const newEntry = this.entryRepository.create({
          sessionId,
          chatId,
          flowId: rawFlow.id,
          currentStepIndex: 0,
          status: 'in_progress',
          collectedData: {},
        });
        await this.entryRepository.save(newEntry);

        const firstQuestion = steps[0].question;
        this.logger.log('Lead flow started by trigger', { sessionId, chatId, flowId: rawFlow.id, trigger: lowerText });
        return { handled: true, replyText: firstQuestion, replyOptions: steps[0].options };
      }
    }

    return { handled: false };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadFlow, LeadFlowStep, LeadFlowCompletionMedia, LeadFlowChoiceDelivery } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { CreateLeadFlowDto, UpdateLeadFlowDto } from './dto/lead-flow.dto';
import { createLogger } from '../../common/services/logger.service';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textValue(value: unknown): string {
  if (!value) return '';
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
      ? String(value)
      : '';
}

function parseDeliveries(value: unknown): LeadFlowChoiceDelivery[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item: unknown) => {
    const delivery = asRecord(item);
    if (
      !delivery ||
      typeof delivery.option !== 'string' ||
      typeof delivery.url !== 'string' ||
      !['document', 'video', 'link'].includes(String(delivery.type))
    )
      return [];
    return [
      {
        option: delivery.option.trim(),
        type: delivery.type as LeadFlowChoiceDelivery['type'],
        url: delivery.url.trim(),
        caption: typeof delivery.caption === 'string' ? delivery.caption : undefined,
        filename: typeof delivery.filename === 'string' ? delivery.filename : undefined,
      },
    ];
  });
}

export function parseSteps(steps: unknown): LeadFlowStep[] {
  if (typeof steps === 'string') {
    try {
      steps = JSON.parse(steps) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(steps)) return [];
  return steps
    .map((value: unknown, index): LeadFlowStep => {
      let step = asRecord(value);
      if (typeof value === 'string') {
        try {
          step = asRecord(JSON.parse(value) as unknown);
        } catch {
          /* Legacy plain-text question. */
        }
      }
      if (!step) return { key: `step_${index + 1}`, question: textValue(value) };
      const deliveries = parseDeliveries(step.deliveries);
      return {
        key: textValue(step.key || step.field || step.id || `step_${index + 1}`),
        question: textValue(step.question || step.prompt || step.text || (typeof value === 'string' ? value : '')),
        options: Array.isArray(step.options)
          ? step.options.map((option: unknown) => textValue(option).trim()).filter(Boolean)
          : undefined,
        ...(step.nativeButtons === true ? { nativeButtons: true } : {}),
        ...(deliveries ? { deliveries } : {}),
      };
    })
    .filter(step => step.question.trim().length > 0);
}

export function parseTriggers(triggers: unknown): string[] {
  if (typeof triggers === 'string') {
    try {
      triggers = JSON.parse(triggers);
    } catch {
      triggers = (triggers as string).split(',').map((t: string) => t.trim());
    }
  }
  if (!Array.isArray(triggers)) return [];
  return triggers.map((t: unknown) => textValue(t).trim()).filter(Boolean);
}

export function parseCollectedData(data: unknown): Record<string, string> {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }
  const record = asRecord(data);
  return record ? Object.fromEntries(Object.entries(record).map(([key, value]) => [key, textValue(value)])) : {};
}

export function parseCompletionMedia(media: unknown): LeadFlowCompletionMedia[] {
  if (typeof media === 'string') {
    try {
      media = JSON.parse(media);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(media)) return [];
  return media.flatMap((entry: unknown) => {
    const item = asRecord(entry);
    if (!item || typeof item.type !== 'string' || !['image', 'document', 'audio', 'video'].includes(item.type))
      return [];
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const base64 = typeof item.base64 === 'string' ? item.base64 : undefined;
    if (!url && !base64?.trim()) return [];
    return [
      {
        type: item.type as LeadFlowCompletionMedia['type'],
        url,
        base64,
        caption: typeof item.caption === 'string' ? item.caption : undefined,
        mimetype: typeof item.mimetype === 'string' ? item.mimetype : undefined,
        filename: typeof item.filename === 'string' ? item.filename : undefined,
      },
    ];
  });
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

  private validateSteps(steps: LeadFlowStep[]): LeadFlowStep[] {
    for (const [index, step] of steps.entries()) {
      if (step.nativeButtons && index !== 0)
        throw new BadRequestException('Enable native buttons only on the first question.');
      if (
        step.nativeButtons &&
        (!step.options ||
          step.options.length < 2 ||
          step.options.length > 3 ||
          step.question.length > 1024 ||
          step.options.some(option => [...option].length > 20) ||
          step.options.some(option => !step.deliveries?.some(delivery => delivery.option === option)))
      )
        throw new BadRequestException(
          'Native buttons need 2–3 choices, titles up to 20 characters, a prompt up to 1024 characters, and a resource for every choice.',
        );
      if (!step.deliveries?.length) continue;
      const options = step.options?.map(option => option.toLowerCase());
      if (!options || options.length < 2 || options.length > 12 || new Set(options).size !== options.length)
        throw new BadRequestException('Delivery choices need 2–12 unique options.');
      const seen = new Set<string>();
      for (const delivery of step.deliveries) {
        const option = delivery.option?.trim().toLowerCase();
        if (!options.includes(option) || seen.has(option) || !['document', 'video', 'link'].includes(delivery.type))
          throw new BadRequestException('Each delivery must match a unique choice.');
        try {
          const url = new URL(delivery.url);
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
        } catch {
          throw new BadRequestException('Delivery URLs must use HTTP or HTTPS.');
        }
        seen.add(option);
      }
    }
    return steps;
  }

  // --- Flow Definitions ---

  async createFlow(sessionId: string, dto: CreateLeadFlowDto): Promise<LeadFlow> {
    let targetSessionId = sessionId;
    if (targetSessionId === 'all') {
      try {
        const rows = await this.flowRepository.query<Array<{ id: string }>>('SELECT id FROM sessions LIMIT 1');
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
      steps: this.validateSteps(parseSteps(dto.steps)),
      completionMessage: dto.completionMessage,
      completionMedia: parseCompletionMedia(dto.completionMedia),
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
    if (dto.steps !== undefined) flow.steps = this.validateSteps(parseSteps(dto.steps));
    if (dto.completionMessage !== undefined) flow.completionMessage = dto.completionMessage;
    if (dto.completionMedia !== undefined) flow.completionMedia = parseCompletionMedia(dto.completionMedia);
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
  ): Promise<{
    handled: boolean;
    replyText?: string;
    replyOptions?: string[];
    completionMedia?: LeadFlowCompletionMedia[] | null;
  }> {
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
      if (flow && !flow.enabled) {
        await this.entryRepository.delete({ id: activeEntry.id });
        return { handled: false };
      }

      if (flow && steps.length > 0) {
        // User cancellation keywords
        if (['cancel', 'stop', 'exit', 'રદ કરો', 'બંધ કરો', 'quit'].includes(lowerText)) {
          await this.entryRepository.delete({ id: activeEntry.id });
          this.logger.log('Lead flow cancelled by user', { sessionId, chatId });
          return { handled: true, replyText: 'ચેટ પ્રક્રિયા રદ કરવામાં આવી છે. (Questionnaire cancelled)' };
        }

        const currentStep = steps[activeEntry.currentStepIndex];
        const data = parseCollectedData(activeEntry.collectedData);

        if (currentStep?.options?.length) {
          const selected = currentStep.options.find(option => option.toLowerCase() === lowerText);
          if (!selected) return { handled: true, replyText: currentStep.question, replyOptions: currentStep.options };
          const delivery = currentStep.deliveries?.find(item => item.option.toLowerCase() === selected.toLowerCase());
          if (delivery) {
            const claimed = await this.entryRepository.update(
              { id: activeEntry.id, status: 'in_progress' },
              {
                collectedData: { ...data, [currentStep.key]: selected },
                currentStepIndex: steps.length,
                status: 'completed',
              },
            );
            // Only one concurrent answer may deliver this resource.
            if (!claimed.affected) return { handled: true };
            this.logger.log('Lead flow resource selected', { sessionId, chatId, flowId: flow.id, type: delivery.type });
            return {
              handled: true,
              replyText:
                delivery.type === 'link'
                  ? [delivery.caption, delivery.url].filter(Boolean).join('\n')
                  : delivery.caption || `Here is your ${selected}.`,
              completionMedia:
                delivery.type === 'link'
                  ? []
                  : [
                      {
                        type: delivery.type,
                        url: delivery.url,
                        caption: delivery.caption,
                        filename: delivery.filename,
                      },
                    ],
            };
          }
        }

        if (currentStep) {
          data[currentStep.key] = normalizedText;
          activeEntry.collectedData = data;
          activeEntry.currentStepIndex += 1;
        }

        if (activeEntry.currentStepIndex >= steps.length) {
          // Completed!
          activeEntry.status = 'completed';
          await this.entryRepository.save(activeEntry);

          let reply =
            flow.completionMessage ||
            'આભાર! તમારી વિગતો નોંધી લેવામાં આવી છે. અમારી ટીમ ટૂંક સમયમાં તમારો સંપર્ક કરશે. 🙏';
          for (const [k, v] of Object.entries(data)) reply = reply.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'gi'), v);
          // Keep {{name}} useful for older flows whose first field was labelled differently.
          if (/{{\\s*name\\s*}}/i.test(reply)) {
            const firstAnswer = Object.values(data)[0];
            if (firstAnswer) reply = reply.replace(/{{\\s*name\\s*}}/gi, firstAnswer);
          }
          // Never expose an unresolved token to a customer.
          reply = reply.replace(/{{\\s*[\\w.-]+\\s*}}/g, '');
          this.logger.log('Lead flow completed successfully', { sessionId, chatId });
          return { handled: true, replyText: reply, completionMedia: parseCompletionMedia(flow.completionMedia) };
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

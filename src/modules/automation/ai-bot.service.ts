import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiAgent } from './entities/ai-agent.entity';
import { AiQueryCapture } from './entities/ai-query-capture.entity';
import { UpdateAiBotConfigDto, ExtractDocumentDto } from './dto/ai-bot.dto';
import { CreateAiAgentDto, UpdateAiAgentDto } from './dto/ai-agent.dto';
import { extractDocumentFromBuffer, type ExtractedDocumentResult } from './document-extractor.util';
import { createLogger } from '../../common/services/logger.service';

const DEFAULT_SYSTEM_PROMPT = `You are an intelligent, friendly, and professional WhatsApp Business Assistant.
Guidelines:
- Answer customer questions clearly, accurately, and concisely.
- Multilingual support: Respond in the same language the customer uses (Gujarati, Hindi, or English).
- Format responses nicely for WhatsApp (use emojis, bullet points, and clean line breaks).
- If you do not know the answer based on the knowledge base, politely offer to connect them with a human team member.`;

const AI_REQUEST_TIMEOUT_MS = 20_000;
const AI_REQUEST_ATTEMPTS = 2;

@Injectable()
export class AiBotService {
  private readonly logger = createLogger('AiBotService');

  constructor(
    @InjectRepository(AiBotConfig, 'data')
    private readonly aiConfigRepository: Repository<AiBotConfig>,
    @InjectRepository(AiAgent, 'data')
    private readonly aiAgentRepository: Repository<AiAgent>,
    @InjectRepository(AiQueryCapture, 'data')
    @Optional()
    private readonly queryCaptureRepository?: Repository<AiQueryCapture>,
    @InjectRepository(AiConversation, 'data')
    @Optional()
    private readonly conversationRepository?: Repository<AiConversation>,
  ) {}

  private requireSession(sessionId: string): void {
    if (!sessionId || sessionId === 'all') throw new BadRequestException('Select a specific WhatsApp account');
  }

  async getOrCreateConfig(sessionId: string): Promise<AiBotConfig> {
    this.requireSession(sessionId);

    let config = await this.aiConfigRepository.findOne({ where: { sessionId } });
    if (!config) {
      config = this.aiConfigRepository.create({
        sessionId,
        enabled: false,
        fallbackEnabled: false,
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-1.5-flash',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        knowledgeBase: '',
        cooldownSeconds: 10,
      });
      await this.aiConfigRepository.save(config);
    }
    return config;
  }

  async getMaskedConfig(sessionId: string): Promise<Record<string, unknown>> {
    const config = await this.getOrCreateConfig(sessionId);
    const maskedApiKey = config.apiKey
      ? config.apiKey.length > 8
        ? `${config.apiKey.slice(0, 4)}••••••••${config.apiKey.slice(-4)}`
        : '••••••••'
      : '';

    return {
      ...config,
      apiKey: maskedApiKey,
      hasApiKey: Boolean(config.apiKey),
    };
  }

  async updateConfig(sessionId: string, dto: UpdateAiBotConfigDto): Promise<Record<string, unknown>> {
    this.requireSession(sessionId);

    const config = await this.getOrCreateConfig(sessionId);

    if (dto.enabled !== undefined) config.enabled = dto.enabled;
    if (dto.fallbackEnabled !== undefined) config.fallbackEnabled = dto.fallbackEnabled;
    if (dto.provider !== undefined) config.provider = dto.provider;
    if (dto.model !== undefined) config.model = dto.model;
    if (dto.systemPrompt !== undefined) config.systemPrompt = dto.systemPrompt;
    if (dto.knowledgeBase !== undefined) config.knowledgeBase = dto.knowledgeBase;
    if (dto.cooldownSeconds !== undefined) config.cooldownSeconds = dto.cooldownSeconds;

    // Only update API key if it's not a masked string or empty placeholder
    const replacementApiKey = dto.apiKey?.trim();
    if (replacementApiKey && !replacementApiKey.includes('••••')) {
      config.apiKey = replacementApiKey;
    }

    await this.aiConfigRepository.save(config);
    return this.getMaskedConfig(sessionId);
  }

  // =========================================================================
  // Multi-Agent CRUD
  // =========================================================================

  async listAgents(sessionId: string): Promise<AiAgent[]> {
    this.requireSession(sessionId);
    const query = this.aiAgentRepository
      .createQueryBuilder('agent')
      .where('agent.sessionId = :sessionId', { sessionId })
      .orderBy('agent.priority', 'DESC')
      .addOrderBy('agent.createdAt', 'ASC');

    return query.getMany();
  }

  async getAgent(id: string, sessionId: string): Promise<AiAgent | null> {
    return this.aiAgentRepository.findOne({ where: { id, sessionId } });
  }

  async createAgent(sessionId: string, dto: CreateAiAgentDto): Promise<AiAgent> {
    this.requireSession(sessionId);
    const agent = this.aiAgentRepository.create({
      sessionId,
      name: dto.name,
      maxReplies: dto.maxReplies ?? 0,
      role: dto.role || 'sales',
      enabled: dto.enabled ?? true,
      priority: dto.priority ?? 0,
      triggerKeywords: dto.triggerKeywords || [],
      audience: dto.audience || 'all',
      targetNumbers: dto.targetNumbers || [],
      messageTypes: dto.messageTypes || [],
      similarMessages: dto.similarMessages || [],
      description: dto.description || null,
      systemPrompt: dto.systemPrompt,
      knowledgeBase: dto.knowledgeBase || null,
    });
    return this.aiAgentRepository.save(agent);
  }

  async updateAgent(id: string, dto: UpdateAiAgentDto, sessionId: string): Promise<AiAgent> {
    this.requireSession(sessionId);
    const agent = await this.aiAgentRepository.findOne({ where: { id, sessionId } });
    if (!agent) {
      throw new NotFoundException(`AI Agent with ID ${id} not found`);
    }

    if (dto.maxReplies !== undefined) agent.maxReplies = dto.maxReplies;
    if (dto.name !== undefined) agent.name = dto.name;
    if (dto.role !== undefined) agent.role = dto.role;
    if (dto.enabled !== undefined) agent.enabled = dto.enabled;
    if (dto.priority !== undefined) agent.priority = dto.priority;
    if (dto.triggerKeywords !== undefined) agent.triggerKeywords = dto.triggerKeywords;
    if (dto.audience !== undefined) agent.audience = dto.audience;
    if (dto.targetNumbers !== undefined) agent.targetNumbers = dto.targetNumbers;
    if (dto.messageTypes !== undefined) agent.messageTypes = dto.messageTypes;
    if (dto.similarMessages !== undefined) agent.similarMessages = dto.similarMessages;
    if (dto.description !== undefined) agent.description = dto.description;
    if (dto.systemPrompt !== undefined) agent.systemPrompt = dto.systemPrompt;
    if (dto.knowledgeBase !== undefined) agent.knowledgeBase = dto.knowledgeBase;

    return this.aiAgentRepository.save(agent);
  }

  async deleteAgent(id: string, sessionId: string): Promise<boolean> {
    this.requireSession(sessionId);
    const res = await this.aiAgentRepository.delete({ id, sessionId });
    return (res.affected ?? 0) > 0;
  }

  // =========================================================================
  // Intent Matching & Multi-Agent Routing
  // =========================================================================

  /**
   * Evaluates inbound message against specialized AI agents for this session.
   * If a matching agent is found, returns that agent.
   */
  async matchAgentForMessage(
    sessionId: string,
    userMessage: string,
    context?: { chatId?: string; messageType?: string; isContact?: boolean },
  ): Promise<AiAgent | null> {
    const agents = await this.listAgents(sessionId);
    const activeAgents = agents.filter(a => a.enabled);
    if (activeAgents.length === 0) return null;

    const lowerText = userMessage.toLowerCase().trim();
    const rawChatId = context?.chatId || '';
    const normalizedChatId = rawChatId.replace(/[^0-9]/g, '');
    const isGroup = rawChatId.endsWith('@g.us');
    const scopedAgents = activeAgents.filter(agent => {
      const audience = agent.audience || 'all';
      if (audience === 'groups' && !isGroup) return false;
      if (audience === 'numbers' && isGroup) return false;
      if (audience === 'selected_groups') {
        if (!isGroup) return false;
        const targets = (agent.targetNumbers || []).map(v => v.trim().toLowerCase()).filter(Boolean);
        if (targets.length === 0) return false;
        const chatLower = rawChatId.toLowerCase();
        const chatDigits = chatLower.replace(/[^0-9]/g, '');
        // Group targeting is intentionally exact. A prefix/substring match can silently route a
        // bot into the wrong group when two WhatsApp group IDs share a numeric prefix.
        const matched = targets.some(target => {
          if (chatLower === target) return true;
          const targetDigits = target.replace(/[^0-9]/g, '');
          return Boolean(targetDigits && chatDigits === targetDigits);
        });
        if (!matched) return false;
      }
      if (audience === 'non_contacts' && (isGroup || context?.isContact !== false)) return false;
      if (audience === 'numbers') {
        const targets = (agent.targetNumbers || []).map(value => value.replace(/[^0-9]/g, '')).filter(Boolean);
        if (
          targets.length > 0 &&
          !targets.some(
            target =>
              normalizedChatId === target || normalizedChatId.endsWith(target) || target.endsWith(normalizedChatId),
          )
        )
          return false;
      }
      const types = (agent.messageTypes || []).map(type => type.toLowerCase().trim()).filter(Boolean);
      if (types.length > 0 && !types.includes((context?.messageType || 'chat').toLowerCase())) return false;
      return true;
    });

    // 1. Check keyword and configured similar-message examples.
    for (const agent of scopedAgents) {
      if (agent.maxReplies) {
        if (isGroup) continue;
        if ((agent.triggerKeywords || []).some(line => line.trim().toLowerCase() === lowerText)) return agent;
        continue;
      }
      const hasWildcard = (agent.triggerKeywords || []).some(
        kw => kw.trim() === '*' || kw.trim().toLowerCase() === 'all',
      );
      // Dedicated group bot: if audience is selected_groups and keywords is empty or has wildcard '*',
      // it matches all messages/queries in that attached group.
      if (
        agent.audience === 'selected_groups' &&
        (!agent.triggerKeywords || agent.triggerKeywords.length === 0 || hasWildcard)
      ) {
        this.logger.log('Matched AI Group Agent (all group queries)', {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          chatId: rawChatId,
        });
        return agent;
      }

      if (!agent.triggerKeywords || agent.triggerKeywords.length === 0) continue;
      for (const rawKw of agent.triggerKeywords) {
        const kw = rawKw.toLowerCase().trim();
        if (!kw) continue;
        if (kw === '*' || kw === 'all') return agent;
        // Word boundary or substring match
        if (lowerText.includes(kw)) {
          this.logger.log('Matched AI Agent by keyword', {
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            keyword: kw,
          });
          return agent;
        }
      }
      for (const example of agent.similarMessages || []) {
        const words = example
          .toLowerCase()
          .split(/\s+/)
          .filter(word => word.length > 3);
        if (
          words.length > 0 &&
          words.filter(word => lowerText.includes(word)).length >= Math.max(1, Math.ceil(words.length * 0.5))
        )
          return agent;
      }
    }

    return null;
  }

  async generateAiResponse(
    sessionId: string,
    userMessage: string,
    context?: { chatId?: string; messageType?: string; isContact?: boolean; senderId?: string; groupName?: string },
  ): Promise<string | null> {
    // 1. Resolve Master Config for LLM API credentials
    if (!sessionId || sessionId === 'all') return null;
    const config = await this.aiConfigRepository.findOne({ where: { sessionId } });

    if (!config || !config.enabled || !config.apiKey) {
      return null;
    }

    // A claimed/closed conversation consumes the message before fallback routing.
    const chatId = context?.chatId;
    if (chatId && !chatId.endsWith('@g.us') && this.conversationRepository) {
      const existing = await this.conversationRepository.findOneBy({ sessionId, chatId });
      if (existing) return this.continueConversation(config, existing, userMessage);
    }

    // 2. Check if a Specialized Agent (Sales, Support, etc.) matches
    const matchedAgent = await this.matchAgentForMessage(sessionId, userMessage, context);

    if (matchedAgent?.maxReplies) {
      if (!chatId || chatId.endsWith('@g.us') || !this.conversationRepository) return null;
      // Exact complete line (case insensitive), never fuzzy/substring initiation.
      if (
        !(matchedAgent.triggerKeywords || []).some(
          line => line.trim().toLowerCase() === userMessage.trim().toLowerCase(),
        )
      )
        return null;
      await this.conversationRepository
        .createQueryBuilder()
        .insert()
        .values({
          sessionId,
          chatId,
          agentId: matchedAgent.id,
          replyCount: 0,
          busy: false,
          history: [],
        })
        .orIgnore()
        .execute();
      const conversation = await this.conversationRepository.findOneByOrFail({ sessionId, chatId });
      return this.continueConversation(config, conversation, userMessage);
    }

    if (matchedAgent) {
      if (this.queryCaptureRepository && context?.chatId?.endsWith('@g.us')) {
        await this.queryCaptureRepository.save(
          this.queryCaptureRepository.create({
            sessionId,
            agentId: matchedAgent.id,
            groupId: context.chatId,
            groupName: context.groupName || null,
            senderPhone: (context.senderId || '').replace(/@(?:c\.us|lid|g\.us)$/i, '').replace(/\D/g, '') || null,
            query: userMessage,
          }),
        );
      }
      return this.callLlmWithCustomInstructions(
        config,
        matchedAgent.systemPrompt,
        matchedAgent.knowledgeBase || '',
        userMessage,
      );
    }

    // 3. Fallback to default Master Assistant ONLY if fallbackEnabled is true
    if (config.fallbackEnabled) {
      return this.callLlm(config, userMessage);
    }

    // When fallback is disabled, do not reply to general messages
    return null;
  }

  private async continueConversation(
    config: AiBotConfig,
    conversation: AiConversation,
    message: string,
  ): Promise<string | null> {
    const repo = this.conversationRepository!;
    const agent = await this.getAgent(conversation.agentId, conversation.sessionId);
    if (!agent?.enabled || !agent.maxReplies || conversation.busy || conversation.replyCount >= agent.maxReplies)
      return null;
    // Compare-and-set prevents parallel workers from exceeding the limit. Reserve before calling AI;
    // failed or interrupted attempts remain counted to avoid accidental extra outbound replies.
    const claim = await repo.update(
      {
        sessionId: conversation.sessionId,
        chatId: conversation.chatId,
        replyCount: conversation.replyCount,
        busy: false,
      },
      { replyCount: conversation.replyCount + 1, busy: true },
    );
    if (!claim.affected) return null;
    try {
      const turn = conversation.replyCount + 1;
      const history = [...conversation.history, { role: 'user' as const, content: message }];
      const response = await this.callLlmWithCustomInstructions(
        config,
        `${agent.systemPrompt}\nThis is reply ${turn} of ${agent.maxReplies}. Ask at most one question per reply. ${turn === agent.maxReplies ? 'This is the final reply. Briefly acknowledge the answers, say the consultation enquiry is recorded for Yogesh, and close politely. Do not ask another question or claim a booking is confirmed.' : 'Ask one relevant consultation qualification question based on the conversation.'}`,
        agent.knowledgeBase || '',
        message,
        conversation.history,
      );
      if (response) history.push({ role: 'assistant', content: response });
      await repo.update({ sessionId: conversation.sessionId, chatId: conversation.chatId }, { history });
      return response;
    } finally {
      await repo.update({ sessionId: conversation.sessionId, chatId: conversation.chatId }, { busy: false });
    }
  }

  async listQueryCaptures(sessionId: string): Promise<AiQueryCapture[]> {
    return this.queryCaptureRepository?.find({ where: { sessionId }, order: { createdAt: 'DESC' } }) ?? [];
  }

  async exportQueryCapturesCsv(sessionId: string): Promise<string> {
    const rows = await this.listQueryCaptures(sessionId);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
      ['Date', 'Bot', 'Group ID', 'Group Name', 'Sender Mobile', 'Query'],
      ...rows.map(r => [r.createdAt.toISOString(), r.agentId, r.groupId, r.groupName, r.senderPhone, r.query]),
    ]
      .map(row => row.map(esc).join(','))
      .join('\n');
  }

  async testPrompt(
    sessionId: string,
    userMessage: string,
    agentId?: string,
  ): Promise<{
    response: string;
    error?: string;
    matchedAgent?: { name: string; role: string; id: string };
    fallbackDisabled?: boolean;
  }> {
    this.requireSession(sessionId);
    const config = await this.aiConfigRepository.findOne({ where: { sessionId } });

    if (!config || !config.apiKey) {
      return { response: '', error: 'API Key is missing. Please enter your API Key and save first.' };
    }

    try {
      // If a specific agent was targeted directly
      if (agentId) {
        const agent = await this.getAgent(agentId, sessionId);
        if (!agent) throw new NotFoundException(`AI Agent with ID ${agentId} not found in this account`);
        if (agent) {
          const resp = await this.callLlmWithCustomInstructions(
            config,
            agent.systemPrompt,
            agent.knowledgeBase || '',
            userMessage,
          );
          return {
            response: resp ?? 'No response generated.',
            matchedAgent: { name: agent.name, role: agent.role, id: agent.id },
          };
        }
      }

      // Otherwise test full smart routing
      const matchedAgent = await this.matchAgentForMessage(sessionId, userMessage);
      if (matchedAgent) {
        const resp = await this.callLlmWithCustomInstructions(
          config,
          matchedAgent.systemPrompt,
          matchedAgent.knowledgeBase || '',
          userMessage,
        );
        return {
          response: resp ?? 'No response generated.',
          matchedAgent: { name: matchedAgent.name, role: matchedAgent.role, id: matchedAgent.id },
        };
      }

      // If no agent matched and fallback bot is disabled
      if (!config.fallbackEnabled) {
        return {
          response:
            'ℹ️ No specialized agent matched this message. Since Default Fallback Bot (ChatGPT) is turned OFF, no message will be sent. (Safe Mode Active)',
          fallbackDisabled: true,
        };
      }

      const response = await this.callLlm(config, userMessage);
      return { response: response ?? 'No response generated by AI.' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { response: '', error: errorMsg };
    }
  }

  async extractDocument(dto: ExtractDocumentDto): Promise<ExtractedDocumentResult> {
    const buf = Buffer.from(dto.contentBase64, 'base64');
    return extractDocumentFromBuffer(buf, dto.filename, dto.mimeType);
  }

  private async callLlmWithCustomInstructions(
    config: AiBotConfig,
    systemPrompt: string,
    knowledgeBaseRaw: string,
    userMessage: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<string | null> {
    let kb = '';
    if (knowledgeBaseRaw && knowledgeBaseRaw.trim().length > 0) {
      kb =
        `\n\n--- OFFICIAL BUSINESS REFERENCE DOCUMENTS & KNOWLEDGE BASE ---\n` +
        `${knowledgeBaseRaw.trim()}\n` +
        `--- END OF REFERENCE DOCUMENTS & KNOWLEDGE BASE ---\n\n` +
        `CRITICAL KNOWLEDGE BASE GROUNDING DIRECTIVE:\n` +
        `1. STRICT GROUNDING: Answer the customer's question strictly and exclusively using the facts, details, figures, policies, specifications, and text provided in the OFFICIAL BUSINESS REFERENCE DOCUMENTS & KNOWLEDGE BASE above.\n` +
        `2. ZERO FABRICATION OR GUESSWORK: If any pricing, rule, policy, or fact is not stated in the provided documents or text, DO NOT invent, assume, or extrapolate it.\n` +
        `3. FALLBACK: If the user's question cannot be answered directly and completely from the provided knowledge base, politely state that this specific detail is not available in the reference documents, and offer to connect them with a human team member.\n` +
        `4. TONE & STYLE: Reply in the same language as the customer's query (e.g. Gujarati, Hindi, English), keep answers professional, concise, polite, and formatted cleanly for WhatsApp.\n`;
    }

    if (config.provider === 'gemini') {
      return this.callGemini(
        config.apiKey,
        config.model || 'gemini-1.5-flash',
        systemPrompt,
        kb,
        history.length
          ? `${history.map(item => `${item.role}: ${item.content}`).join('\n')}\nuser: ${userMessage}`
          : userMessage,
      );
    } else {
      return this.callOpenAi(config.apiKey, config.model || 'gpt-4o-mini', systemPrompt, kb, userMessage, history);
    }
  }

  private async callLlm(config: AiBotConfig, userMessage: string): Promise<string | null> {
    const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const knowledgeBase = config.knowledgeBase
      ? `\n\n--- BUSINESS KNOWLEDGE BASE & FAQs ---\n${config.knowledgeBase.trim()}\n--- END OF KNOWLEDGE BASE ---\n` +
        `\nGrounding Rule: Prioritize the verified facts and details in the BUSINESS KNOWLEDGE BASE above when answering.\n`
      : '';

    if (config.provider === 'gemini') {
      return this.callGemini(
        config.apiKey,
        config.model || 'gemini-1.5-flash',
        systemPrompt,
        knowledgeBase,
        userMessage,
      );
    } else {
      return this.callOpenAi(config.apiKey, config.model || 'gpt-4o-mini', systemPrompt, knowledgeBase, userMessage);
    }
  }

  private async callGemini(
    apiKey: string,
    model: string,
    systemPrompt: string,
    knowledgeBase: string,
    userMessage: string,
  ): Promise<string | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const fullPrompt = `${systemPrompt}${knowledgeBase}\n\nCustomer WhatsApp Message:\n"${userMessage}"\n\nYour Response:`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: fullPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
      },
    };

    const res = await this.fetchAiProvider(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      this.logger.warn('Gemini API call failed', { status: res.status, error: errorText });
      throw new Error(`Gemini API Error (${res.status}): ${errorText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return answer ? answer.trim() : null;
  }

  private async callOpenAi(
    apiKey: string,
    model: string,
    systemPrompt: string,
    knowledgeBase: string,
    userMessage: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<string | null> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const systemInstruction = `${systemPrompt}${knowledgeBase}`;

    const body = {
      model,
      messages: [{ role: 'system', content: systemInstruction }, ...history, { role: 'user', content: userMessage }],
      max_tokens: 1000,
      temperature: 0.7,
    };

    const res = await this.fetchAiProvider(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      this.logger.warn('OpenAI API call failed', { status: res.status, error: errorText });
      throw new Error(`OpenAI API Error (${res.status}): ${errorText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const answer = data.choices?.[0]?.message?.content;
    return answer ? answer.trim() : null;
  }

  /**
   * A provider connection can remain open without ever returning a response. That used to leave
   * the live inbound-message pipeline pending forever, while the dashboard simulator could still
   * appear healthy on a later request. Bound every attempt and retry one transient network hang;
   * HTTP responses are returned to the caller so its existing provider error remains actionable.
   */
  private async fetchAiProvider(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= AI_REQUEST_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error(`AI provider timed out after ${AI_REQUEST_TIMEOUT_MS}ms`)),
        AI_REQUEST_TIMEOUT_MS,
      );
      try {
        return await fetch(url, {
          ...init,
          signal: controller.signal,
        });
      } catch (error) {
        lastError = error;
        this.logger.warn('AI provider request failed', {
          attempt,
          attempts: AI_REQUEST_ATTEMPTS,
          timeoutMs: AI_REQUEST_TIMEOUT_MS,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('AI provider request failed');
  }
}

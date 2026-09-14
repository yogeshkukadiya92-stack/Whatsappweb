import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { AiAgent } from './entities/ai-agent.entity';
import { UpdateAiBotConfigDto } from './dto/ai-bot.dto';
import { CreateAiAgentDto, UpdateAiAgentDto } from './dto/ai-agent.dto';
import { createLogger } from '../../common/services/logger.service';

const DEFAULT_SYSTEM_PROMPT = `You are an intelligent, friendly, and professional WhatsApp Business Assistant.
Guidelines:
- Answer customer questions clearly, accurately, and concisely.
- Multilingual support: Respond in the same language the customer uses (Gujarati, Hindi, or English).
- Format responses nicely for WhatsApp (use emojis, bullet points, and clean line breaks).
- If you do not know the answer based on the knowledge base, politely offer to connect them with a human team member.`;

@Injectable()
export class AiBotService {
  private readonly logger = createLogger('AiBotService');

  constructor(
    @InjectRepository(AiBotConfig, 'data')
    private readonly aiConfigRepository: Repository<AiBotConfig>,
    @InjectRepository(AiAgent, 'data')
    private readonly aiAgentRepository: Repository<AiAgent>,
  ) {}

  async getOrCreateConfig(sessionId: string): Promise<AiBotConfig> {
    if (sessionId === 'all') {
      const existing = await this.aiConfigRepository.findOne({ where: {} });
      if (existing) return existing;
      try {
        const rows: any = await this.aiConfigRepository.query('SELECT id FROM sessions LIMIT 1');
        if (rows && rows.length > 0 && rows[0].id) {
          sessionId = rows[0].id;
        }
      } catch {
        // use 'all' if query not possible
      }
    }

    let config = await this.aiConfigRepository.findOne({ where: { sessionId } });
    if (!config) {
      config = this.aiConfigRepository.create({
        sessionId,
        enabled: false,
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
    if (sessionId === 'all') {
      const allConfigs = await this.aiConfigRepository.find();
      for (const cfg of allConfigs) {
        if (dto.enabled !== undefined) cfg.enabled = dto.enabled;
        if (dto.provider !== undefined) cfg.provider = dto.provider;
        if (dto.model !== undefined) cfg.model = dto.model;
        if (dto.systemPrompt !== undefined) cfg.systemPrompt = dto.systemPrompt;
        if (dto.knowledgeBase !== undefined) cfg.knowledgeBase = dto.knowledgeBase;
        if (dto.cooldownSeconds !== undefined) cfg.cooldownSeconds = dto.cooldownSeconds;
        const replacementApiKey = dto.apiKey?.trim();
        if (replacementApiKey && !replacementApiKey.includes('••••')) {
          cfg.apiKey = replacementApiKey;
        }
        await this.aiConfigRepository.save(cfg);
      }
      if (allConfigs.length > 0) {
        return this.getMaskedConfig(allConfigs[0].sessionId);
      }
    }

    const config = await this.getOrCreateConfig(sessionId);

    if (dto.enabled !== undefined) config.enabled = dto.enabled;
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
    // Return agents specific to this session as well as global agents ('all')
    const query = this.aiAgentRepository.createQueryBuilder('agent')
      .where('agent.sessionId = :sessionId OR agent.sessionId = :all', { sessionId, all: 'all' })
      .orderBy('agent.priority', 'DESC')
      .addOrderBy('agent.createdAt', 'ASC');

    return query.getMany();
  }

  async getAgent(id: string): Promise<AiAgent | null> {
    return this.aiAgentRepository.findOne({ where: { id } });
  }

  async createAgent(sessionId: string, dto: CreateAiAgentDto): Promise<AiAgent> {
    const agent = this.aiAgentRepository.create({
      sessionId,
      name: dto.name,
      role: dto.role || 'sales',
      enabled: dto.enabled ?? true,
      priority: dto.priority ?? 0,
      triggerKeywords: dto.triggerKeywords || [],
      description: dto.description || null,
      systemPrompt: dto.systemPrompt,
      knowledgeBase: dto.knowledgeBase || null,
    });
    return this.aiAgentRepository.save(agent);
  }

  async updateAgent(id: string, dto: UpdateAiAgentDto): Promise<AiAgent> {
    const agent = await this.aiAgentRepository.findOne({ where: { id } });
    if (!agent) {
      throw new Error(`AI Agent with ID ${id} not found`);
    }

    if (dto.name !== undefined) agent.name = dto.name;
    if (dto.role !== undefined) agent.role = dto.role;
    if (dto.enabled !== undefined) agent.enabled = dto.enabled;
    if (dto.priority !== undefined) agent.priority = dto.priority;
    if (dto.triggerKeywords !== undefined) agent.triggerKeywords = dto.triggerKeywords;
    if (dto.description !== undefined) agent.description = dto.description;
    if (dto.systemPrompt !== undefined) agent.systemPrompt = dto.systemPrompt;
    if (dto.knowledgeBase !== undefined) agent.knowledgeBase = dto.knowledgeBase;

    return this.aiAgentRepository.save(agent);
  }

  async deleteAgent(id: string): Promise<boolean> {
    const res = await this.aiAgentRepository.delete({ id });
    return (res.affected ?? 0) > 0;
  }

  // =========================================================================
  // Intent Matching & Multi-Agent Routing
  // =========================================================================

  /**
   * Evaluates inbound message against specialized AI agents for this session.
   * If a matching agent is found, returns that agent.
   */
  async matchAgentForMessage(sessionId: string, userMessage: string): Promise<AiAgent | null> {
    const agents = await this.listAgents(sessionId);
    const activeAgents = agents.filter(a => a.enabled);
    if (activeAgents.length === 0) return null;

    const lowerText = userMessage.toLowerCase().trim();

    // 1. Check keyword triggers sorted by priority (higher priority first)
    for (const agent of activeAgents) {
      if (!agent.triggerKeywords || agent.triggerKeywords.length === 0) continue;
      for (const rawKw of agent.triggerKeywords) {
        const kw = rawKw.toLowerCase().trim();
        if (!kw) continue;
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
    }

    return null;
  }

  async generateAiResponse(sessionId: string, userMessage: string): Promise<string | null> {
    // 1. Resolve Master Config for LLM API credentials
    let config = await this.aiConfigRepository.findOne({ where: { sessionId } });
    if (!config || !config.enabled || !config.apiKey) {
      // Global fallback: check if any session has an active enabled AI config
      const activeConfigs = await this.aiConfigRepository.find({ where: { enabled: true } });
      const valid = activeConfigs.find(c => Boolean(c.apiKey && c.apiKey.trim().length > 0));
      if (valid) {
        config = valid;
      }
    }

    if (!config || !config.enabled || !config.apiKey) {
      return null;
    }

    // 2. Check if a Specialized Agent (Sales, Support, etc.) matches
    const matchedAgent = await this.matchAgentForMessage(sessionId, userMessage);

    if (matchedAgent) {
      return this.callLlmWithCustomInstructions(
        config,
        matchedAgent.systemPrompt,
        matchedAgent.knowledgeBase || '',
        userMessage,
      );
    }

    // 3. Fallback to default Master Assistant
    return this.callLlm(config, userMessage);
  }

  async testPrompt(
    sessionId: string,
    userMessage: string,
    agentId?: string,
  ): Promise<{ response: string; error?: string; matchedAgent?: { name: string; role: string; id: string } }> {
    let config = await this.aiConfigRepository.findOne({ where: { sessionId } });
    if (!config || !config.apiKey) {
      const anyConfig = await this.aiConfigRepository.findOne({ where: {} });
      if (anyConfig && anyConfig.apiKey) {
        config = anyConfig;
      }
    }

    if (!config || !config.apiKey) {
      return { response: '', error: 'API Key is missing. Please enter your API Key and save first.' };
    }

    try {
      // If a specific agent was targeted directly
      if (agentId) {
        const agent = await this.getAgent(agentId);
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

      const response = await this.callLlm(config, userMessage);
      return { response: response ?? 'No response generated by AI.' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { response: '', error: errorMsg };
    }
  }

  private async callLlmWithCustomInstructions(
    config: AiBotConfig,
    systemPrompt: string,
    knowledgeBaseRaw: string,
    userMessage: string,
  ): Promise<string | null> {
    const kb = knowledgeBaseRaw
      ? `\n\n--- BUSINESS KNOWLEDGE BASE & FAQs ---\n${knowledgeBaseRaw}\n--- END OF KNOWLEDGE BASE ---\n`
      : '';

    if (config.provider === 'gemini') {
      return this.callGemini(config.apiKey, config.model || 'gemini-1.5-flash', systemPrompt, kb, userMessage);
    } else {
      return this.callOpenAi(config.apiKey, config.model || 'gpt-4o-mini', systemPrompt, kb, userMessage);
    }
  }

  private async callLlm(config: AiBotConfig, userMessage: string): Promise<string | null> {
    const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const knowledgeBase = config.knowledgeBase
      ? `\n\n--- BUSINESS KNOWLEDGE BASE & FAQs ---\n${config.knowledgeBase}\n--- END OF KNOWLEDGE BASE ---\n`
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

    const res = await fetch(url, {
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
  ): Promise<string | null> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const systemInstruction = `${systemPrompt}${knowledgeBase}`;

    const body = {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    };

    const res = await fetch(url, {
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
}

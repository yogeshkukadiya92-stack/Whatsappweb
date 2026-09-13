import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { UpdateAiBotConfigDto } from './dto/ai-bot.dto';
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

  async generateAiResponse(sessionId: string, userMessage: string): Promise<string | null> {
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

    return this.callLlm(config, userMessage);
  }

  async testPrompt(sessionId: string, userMessage: string): Promise<{ response: string; error?: string }> {
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
      const response = await this.callLlm(config, userMessage);
      return { response: response ?? 'No response generated by AI.' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { response: '', error: errorMsg };
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

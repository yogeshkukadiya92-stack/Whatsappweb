import { DataSource } from 'typeorm';
import { AiBotService } from './ai-bot.service';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { AiAgent } from './entities/ai-agent.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('AiBotService', () => {
  let ds: DataSource;
  let service: AiBotService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, AiBotConfig, AiAgent],
      synchronize: true,
    });
    await ds.initialize();

    const sessions = ds.getRepository(Session);
    await sessions.save(sessions.create({ id: 'sess1', name: 'sess1', status: SessionStatus.READY, config: {} }));

    service = new AiBotService(ds.getRepository(AiBotConfig), ds.getRepository(AiAgent));
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates default config on getOrCreateConfig if none exists', async () => {
    const config = await service.getOrCreateConfig('sess1');
    expect(config).toBeDefined();
    expect(config.sessionId).toBe('sess1');
    expect(config.enabled).toBe(false);
    expect(config.fallbackEnabled).toBe(false);
    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-1.5-flash');
  });

  it('updates fallbackEnabled', async () => {
    await service.updateConfig('sess1', { fallbackEnabled: true });
    const config = await service.getOrCreateConfig('sess1');
    expect(config.fallbackEnabled).toBe(true);

    await service.updateConfig('sess1', { fallbackEnabled: false });
    const updated = await service.getOrCreateConfig('sess1');
    expect(updated.fallbackEnabled).toBe(false);
  });

  it('returns null for general message when AI engine is enabled but fallbackEnabled is false', async () => {
    await service.updateConfig('sess1', {
      apiKey: 'test-api-key',
      enabled: true,
      fallbackEnabled: false,
    });

    const resp = await service.generateAiResponse('sess1', 'Random chat message');
    expect(resp).toBeNull();
  });

  it('routes to specialized agent even when fallbackEnabled is false', async () => {
    await service.updateConfig('sess1', {
      apiKey: 'test-api-key',
      enabled: true,
      fallbackEnabled: false,
    });

    await service.createAgent('sess1', {
      name: 'Sales Specialist',
      role: 'sales',
      systemPrompt: 'You are sales specialist.',
      triggerKeywords: ['price', 'cost'],
      audience: 'all',
      priority: 10,
    });

    jest.spyOn(service as any, 'callLlmWithCustomInstructions').mockResolvedValue('Sales response for price');

    const resp = await service.generateAiResponse('sess1', 'what is the price?');
    expect(resp).toBe('Sales response for price');
  });

  it('returns fallbackDisabled in testPrompt when fallbackEnabled is false and no agent matched', async () => {
    await service.updateConfig('sess1', {
      apiKey: 'test-api-key',
      enabled: true,
      fallbackEnabled: false,
    });

    const result = await service.testPrompt('sess1', 'unmatched random question');
    expect(result.fallbackDisabled).toBe(true);
    expect(result.response).toContain('Safe Mode Active');
  });

  it('masks API key when getMaskedConfig is called', async () => {
    await service.updateConfig('sess1', { apiKey: 'AIzaSyExampleSecretKey12345' });
    const masked = await service.getMaskedConfig('sess1');
    expect(masked.hasApiKey).toBe(true);
    expect(masked.apiKey).toContain('••••');
    expect(masked.apiKey).not.toBe('AIzaSyExampleSecretKey12345');
  });

  it('keeps the saved API key when an update sends an empty or masked placeholder', async () => {
    await service.updateConfig('sess1', { apiKey: 'sk-existing-secret' });

    await service.updateConfig('sess1', { apiKey: '   ', systemPrompt: 'Updated prompt' });
    await service.updateConfig('sess1', { apiKey: 'sk-e••••cret', knowledgeBase: 'Updated facts' });

    const stored = await ds.getRepository(AiBotConfig).findOneByOrFail({ sessionId: 'sess1' });
    expect(stored.apiKey).toBe('sk-existing-secret');
    expect(stored.systemPrompt).toBe('Updated prompt');
    expect(stored.knowledgeBase).toBe('Updated facts');
  });

  it('updates provider, systemPrompt and knowledgeBase', async () => {
    await service.updateConfig('sess1', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Custom prompt',
      knowledgeBase: 'Price is $10',
      enabled: true,
    });

    const config = await service.getOrCreateConfig('sess1');
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.systemPrompt).toBe('Custom prompt');
    expect(config.knowledgeBase).toBe('Price is $10');
    expect(config.enabled).toBe(true);
  });

  it('returns null if AI bot is disabled or apiKey is missing', async () => {
    const response = await service.generateAiResponse('sess1', 'hello');
    expect(response).toBeNull();
  });

  it('times out a stalled provider request and retries once', async () => {
    jest.useFakeTimers();
    const originalFetch = global.fetch;
    const fetchMock = jest
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Recovered response' }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    try {
      const responsePromise = (service as unknown as {
        callGemini: (
          apiKey: string,
          model: string,
          systemPrompt: string,
          knowledgeBase: string,
          userMessage: string,
        ) => Promise<string | null>;
      }).callGemini('key', 'model', 'system', '', 'price');

      await jest.advanceTimersByTimeAsync(20_000);

      await expect(responsePromise).resolves.toBe('Recovered response');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
      jest.useRealTimers();
    }
  });

  describe('matchAgentForMessage', () => {
    it('routes a specialized bot only to the exact selected WhatsApp group', async () => {
      const agent = await service.createAgent('sess1', {
        name: 'Sales Group Bot',
        role: 'sales',
        systemPrompt: 'Answer sales questions from the sales knowledge base.',
        knowledgeBase: 'Product A costs ₹500.',
        triggerKeywords: ['price', 'ભાવ'],
        audience: 'selected_groups',
        targetNumbers: ['120363012345678901@g.us'],
        priority: 20,
      });

      await expect(
        service.matchAgentForMessage('sess1', 'ભાવ શું છે?', {
          chatId: '120363012345678901@g.us',
        }),
      ).resolves.toMatchObject({ id: agent.id });

      await expect(
        service.matchAgentForMessage('sess1', 'ભાવ શું છે?', {
          chatId: '120363012345678999@g.us',
        }),
      ).resolves.toBeNull();
    });

    it('matches agent targeted to specific numbers and rejects unlisted numbers or groups', async () => {
      await service.createAgent('sess1', {
        name: 'VIP Client Agent',
        role: 'custom',
        systemPrompt: 'You are a VIP assistant.',
        triggerKeywords: ['help', 'pricing'],
        audience: 'numbers',
        targetNumbers: ['+91 98765 43210', '919811111111'],
        priority: 50,
      });

      const match1 = await service.matchAgentForMessage('sess1', 'need help', { chatId: '919876543210@c.us' });
      expect(match1).not.toBeNull();
      expect(match1?.name).toBe('VIP Client Agent');

      const matchOther = await service.matchAgentForMessage('sess1', 'need help', { chatId: '919899999999@c.us' });
      expect(matchOther).toBeNull();

      const matchGroup = await service.matchAgentForMessage('sess1', 'need help', { chatId: '919876543210@g.us' });
      expect(matchGroup).toBeNull();
    });

    it('matches agent targeted to selected groups and rejects other groups or direct chats', async () => {
      await service.createAgent('sess1', {
        name: 'Group Support Agent',
        role: 'support',
        systemPrompt: 'You are a support assistant.',
        triggerKeywords: ['support'],
        audience: 'selected_groups',
        targetNumbers: ['120363024829392@g.us'],
        priority: 50,
      });

      const matchGroup = await service.matchAgentForMessage('sess1', 'need support', { chatId: '120363024829392@g.us' });
      expect(matchGroup).not.toBeNull();
      expect(matchGroup?.name).toBe('Group Support Agent');

      const matchOtherGroup = await service.matchAgentForMessage('sess1', 'need support', { chatId: '120363999999999@g.us' });
      expect(matchOtherGroup).toBeNull();

      const matchDirect = await service.matchAgentForMessage('sess1', 'need support', { chatId: '120363024829392@c.us' });
      expect(matchDirect).toBeNull();
    });
  });

  describe('extractDocument', () => {
    it('extracts base64 document content properly', async () => {
      const text = 'SKU,Item,Price\n1,Product A,$10\n2,Product B,$20';
      const base64 = Buffer.from(text, 'utf8').toString('base64');
      const res = await service.extractDocument({
        filename: 'items.csv',
        contentBase64: base64,
        mimeType: 'text/csv',
      });
      expect(res.extractedText).toContain('| SKU | Item | Price |');
      expect(res.extractedText).toContain('| 1 | Product A | $10 |');
      expect(res.charCount).toBeGreaterThan(0);
    });
  });
});

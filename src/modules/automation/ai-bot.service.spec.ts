import { AddBoundedAiConversations1793600000000 } from '../../database/migrations/1793600000000-AddBoundedAiConversations';
import { DataSource } from 'typeorm';
import { AiBotService } from './ai-bot.service';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiAgent } from './entities/ai-agent.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('AiBotService', () => {
  let ds: DataSource;
  let service: AiBotService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, AiBotConfig, AiAgent, AiConversation],
      synchronize: true,
    });
    await ds.initialize();

    const sessions = ds.getRepository(Session);
    await sessions.save(sessions.create({ id: 'sess1', name: 'sess1', status: SessionStatus.READY, config: {} }));

    service = new AiBotService(
      ds.getRepository(AiBotConfig),
      ds.getRepository(AiAgent),
      undefined,
      ds.getRepository(AiConversation),
    );
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
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Recovered response' }] } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    try {
      const responsePromise = (
        service as unknown as {
          callGemini: (
            apiKey: string,
            model: string,
            systemPrompt: string,
            knowledgeBase: string,
            userMessage: string,
          ) => Promise<string | null>;
        }
      ).callGemini('key', 'model', 'system', '', 'price');

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

      const matchGroup = await service.matchAgentForMessage('sess1', 'need support', {
        chatId: '120363024829392@g.us',
      });
      expect(matchGroup).not.toBeNull();
      expect(matchGroup?.name).toBe('Group Support Agent');

      const matchOtherGroup = await service.matchAgentForMessage('sess1', 'need support', {
        chatId: '120363999999999@g.us',
      });
      expect(matchOtherGroup).toBeNull();

      const matchDirect = await service.matchAgentForMessage('sess1', 'need support', {
        chatId: '120363024829392@c.us',
      });
      expect(matchDirect).toBeNull();
    });

    it('matches group_query bot answering all member questions without requiring trigger keywords', async () => {
      await service.createAgent('sess1', {
        name: 'VIP Group Query Solver',
        role: 'group_query',
        systemPrompt: 'You are the group query bot.',
        triggerKeywords: ['*'],
        audience: 'selected_groups',
        targetNumbers: ['120363077777777@g.us'],
        priority: 60,
      });

      // Member asks any random question without keyword
      const matchRandom = await service.matchAgentForMessage('sess1', 'કોઈને ખબર છે મીટિંગ ક્યારે છે?', {
        chatId: '120363077777777@g.us',
      });
      expect(matchRandom).not.toBeNull();
      expect(matchRandom?.name).toBe('VIP Group Query Solver');
      expect(matchRandom?.role).toBe('group_query');

      // Different group should not match
      const matchOther = await service.matchAgentForMessage('sess1', 'કોઈને ખબર છે મીટિંગ ક્યારે છે?', {
        chatId: '120363088888888@g.us',
      });
      expect(matchOther).toBeNull();
    });
  });

  it('routes arbitrary messages to an all-message bot while respecting audience and message types', async () => {
    const agent = await service.createAgent('sess1', {
      name: 'General ChatGPT Auto Reply',
      role: 'custom',
      triggerKeywords: ['*'],
      audience: 'non_contacts',
      messageTypes: ['chat'],
      systemPrompt: 'Reply helpfully in the sender language.',
    });
    const context = { chatId: '919876543210@c.us', isContact: false, messageType: 'chat' };
    for (const message of ['Hello there!', 'આજે તમે કેમ છો?', 'Tell me a story']) {
      expect((await service.matchAgentForMessage('sess1', message, context))?.id).toBe(agent.id);
    }
    expect(await service.matchAgentForMessage('sess1', 'Hello', { ...context, isContact: true })).toBeNull();
    expect(await service.matchAgentForMessage('sess1', 'Hello', { ...context, messageType: 'image' })).toBeNull();
    expect(await service.matchAgentForMessage('sess1', 'Hello', { ...context, chatId: '123@g.us' })).toBeNull();
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
  it('applies and reverses the conversation migration', async () => {
    const runner = ds.createQueryRunner();
    await runner.dropTable('ai_conversations');
    await runner.dropColumn('ai_agents', 'maxReplies');
    const migration = new AddBoundedAiConversations1793600000000();
    await migration.up(runner);
    expect(await runner.hasTable('ai_conversations')).toBe(true);
    expect(await runner.hasColumn('ai_agents', 'maxReplies')).toBe(true);
    await migration.down(runner);
    expect(await runner.hasTable('ai_conversations')).toBe(false);
    expect(await runner.hasColumn('ai_agents', 'maxReplies')).toBe(false);
    await runner.release();
  });

  describe('bounded consultation', () => {
    const trigger = 'Hi Yogesh, I want to book a free AI strategy consultation.';
    const context = { chatId: '919999999999@c.us' };
    let llm: jest.SpyInstance;
    beforeEach(async () => {
      await service.updateConfig('sess1', { apiKey: 'test', enabled: true, fallbackEnabled: true });
      await service.createAgent('sess1', {
        name: 'Consultation',
        systemPrompt: 'Consultation assistant',
        audience: 'numbers',
        triggerKeywords: [trigger],
        maxReplies: 3,
      });
      llm = jest.spyOn(service as any, 'callLlmWithCustomInstructions').mockResolvedValue('AI answer');
      jest.spyOn(service as any, 'callLlm').mockResolvedValue('Fallback');
    });
    it('matches only the complete trigger and excludes groups', async () => {
      expect(await service.matchAgentForMessage('sess1', 'Hi Yogesh', context)).toBeNull();
      expect(await service.matchAgentForMessage('sess1', 'prefix ' + trigger, context)).toBeNull();
      expect(await service.matchAgentForMessage('sess1', trigger, { chatId: '123@g.us' })).toBeNull();
      expect(await service.matchAgentForMessage('sess1', trigger, context)).not.toBeNull();
    });
    it('keeps history, closes at three and stays closed across service restart even with fallback enabled', async () => {
      expect(await service.generateAiResponse('sess1', trigger, context)).toBe('AI answer');
      expect(await service.generateAiResponse('sess1', 'I run a shop', context)).toBe('AI answer');
      expect(llm.mock.calls[1][4]).toEqual([
        { role: 'user', content: trigger },
        { role: 'assistant', content: 'AI answer' },
      ]);
      expect(await service.generateAiResponse('sess1', 'I need automation', context)).toBe('AI answer');
      service = new AiBotService(
        ds.getRepository(AiBotConfig),
        ds.getRepository(AiAgent),
        undefined,
        ds.getRepository(AiConversation),
      );
      expect(await service.generateAiResponse('sess1', trigger, context)).toBeNull();
      expect(await service.generateAiResponse('sess1', 'more', context)).toBeNull();
      expect(llm).toHaveBeenCalledTimes(3);
    });
    it('claims only one response during a burst', async () => {
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => service.generateAiResponse('sess1', trigger, context)),
      );
      expect(replies.filter(Boolean)).toHaveLength(1);
      expect(llm).toHaveBeenCalledTimes(1);
    });
    it('bounds failed attempts and clears busy state', async () => {
      llm.mockRejectedValue(new Error('offline'));
      for (let i = 0; i < 3; i++)
        await expect(service.generateAiResponse('sess1', trigger, context)).rejects.toThrow('offline');
      expect(await service.generateAiResponse('sess1', trigger, context)).toBeNull();
      expect(
        (await ds.getRepository(AiConversation).findOneByOrFail({ sessionId: 'sess1', chatId: context.chatId })).busy,
      ).toBe(false);
    });
  });
  describe('account isolation', () => {
    beforeEach(async () => {
      await ds.getRepository(Session).save({ id: 'sess2', name: 'second', status: SessionStatus.READY, config: {} });
      await service.updateConfig('sess1', { apiKey: 'first-account-key', enabled: true, fallbackEnabled: true });
    });
    it('does not borrow an enabled config when this account is missing, disabled, or has no key', async () => {
      const llm = jest.spyOn(service as any, 'callLlm').mockResolvedValue('wrong');
      expect(await service.generateAiResponse('sess2', 'hello')).toBeNull();
      await service.updateConfig('sess2', { enabled: false, apiKey: 'second-account-key' });
      expect(await service.generateAiResponse('sess2', 'hello')).toBeNull();
      await ds.getRepository(AiBotConfig).update({ sessionId: 'sess2' }, { enabled: true, apiKey: '' });
      expect(await service.generateAiResponse('sess2', 'hello')).toBeNull();
      expect(llm).not.toHaveBeenCalled();
      expect((await service.testPrompt('sess2', 'hello')).error).toContain('API Key is missing');
    });
    it('isolates agent matching, editing, deletion, and simulator by owning account', async () => {
      const agent = await service.createAgent('sess1', {
        name: 'one',
        systemPrompt: 'first',
        triggerKeywords: ['hello'],
      });
      await service.updateConfig('sess2', { apiKey: 'second-key', enabled: true });
      expect(await service.listAgents('sess2')).toEqual([]);
      expect(await service.matchAgentForMessage('sess2', 'hello')).toBeNull();
      await expect(service.updateAgent(agent.id, { name: 'changed' }, 'sess2')).rejects.toThrow();
      expect(await service.deleteAgent(agent.id, 'sess2')).toBe(false);
      expect((await service.getAgent(agent.id, 'sess1'))?.name).toBe('one');
      expect((await service.testPrompt('sess2', 'hello', agent.id)).error).toContain('not found in this account');
      expect(await service.generateAiResponse('sess2', 'hello')).toBeNull();
    });
    it('never applies AI settings to all accounts implicitly', async () => {
      await expect(service.updateConfig('all', { enabled: false })).rejects.toThrow(
        'Select a specific WhatsApp account',
      );
      await expect(
        service.createAgent('all', { name: 'all', systemPrompt: 'test', triggerKeywords: ['hi'] }),
      ).rejects.toThrow();
      expect((await service.getOrCreateConfig('sess1')).enabled).toBe(true);
    });
  });
});

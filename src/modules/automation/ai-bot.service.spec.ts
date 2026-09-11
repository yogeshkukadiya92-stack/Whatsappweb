import { DataSource } from 'typeorm';
import { AiBotService } from './ai-bot.service';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('AiBotService', () => {
  let ds: DataSource;
  let service: AiBotService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, AiBotConfig],
      synchronize: true,
    });
    await ds.initialize();

    const sessions = ds.getRepository(Session);
    await sessions.save(
      sessions.create({ id: 'sess1', name: 'sess1', status: SessionStatus.READY, config: {} }),
    );

    service = new AiBotService(ds.getRepository(AiBotConfig));
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates default config on getOrCreateConfig if none exists', async () => {
    const config = await service.getOrCreateConfig('sess1');
    expect(config).toBeDefined();
    expect(config.sessionId).toBe('sess1');
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-1.5-flash');
  });

  it('masks API key when getMaskedConfig is called', async () => {
    await service.updateConfig('sess1', { apiKey: 'AIzaSyExampleSecretKey12345' });
    const masked = await service.getMaskedConfig('sess1');
    expect(masked.hasApiKey).toBe(true);
    expect(masked.apiKey).toContain('••••');
    expect(masked.apiKey).not.toBe('AIzaSyExampleSecretKey12345');
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
});

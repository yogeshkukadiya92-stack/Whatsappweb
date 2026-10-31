import { StudioConnection } from './entities/studio-connection.entity';
import { StudioConnectionService } from './studio-connection.service';
import { Session } from '../session/entities/session.entity';
import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiBotService } from './ai-bot.service';
import { AiAgent } from './entities/ai-agent.entity';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { AiQueryCapture } from './entities/ai-query-capture.entity';
import {
  CreateLeadFlowDto,
  UpdateLeadFlowDto,
  LeadFlowStepDto,
  LeadFlowCompletionMediaDto,
  LeadFlowChoiceDeliveryDto,
} from './dto/lead-flow.dto';

describe('saved AI routing and query reports', () => {
  let db: DataSource;
  let service: AiBotService;
  beforeEach(async () => {
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, AiAgent, AiBotConfig, AiQueryCapture, StudioConnection],
      synchronize: true,
    });
    await db.initialize();
    await db.getRepository(Session).save([
      { id: 'owner', name: 'Owner session' },
      { id: 'other', name: 'Other session' },
    ]);
    service = new AiBotService(
      db.getRepository(AiBotConfig),
      db.getRepository(AiAgent),
      db.getRepository(AiQueryCapture),
    );
  });
  afterEach(async () => {
    if (db.isInitialized) await db.destroy();
  });
  it('persists complete routing edits and refuses another session agent even with a valid agent ID', async () => {
    const agent = await service.createAgent('owner', {
      name: 'Sales',
      systemPrompt: 'Use verified prices',
      triggerKeywords: ['price'],
    });
    expect(await service.getAgent(agent.id)).toMatchObject({ sessionId: 'owner', role: 'sales', enabled: true });
    await expect(service.updateAgent(agent.id, { name: 'Stolen' }, 'other')).rejects.toThrow('not found');
    expect(await service.deleteAgent(agent.id, 'other')).toBe(false);
    const updated = await service.updateAgent(
      agent.id,
      {
        name: 'Support',
        role: 'support',
        enabled: false,
        priority: 5,
        triggerKeywords: ['help'],
        audience: 'numbers',
        targetNumbers: ['919999999999'],
        messageTypes: ['chat'],
        similarMessages: ['help with a customer order'],
        description: 'Saved description',
        systemPrompt: 'Use verified support details',
        knowledgeBase: 'Refund policy',
      },
      'owner',
    );
    expect(await service.getAgent(agent.id)).toEqual(updated);
    expect(updated).toMatchObject({
      name: 'Support',
      enabled: false,
      priority: 5,
      audience: 'numbers',
      knowledgeBase: 'Refund policy',
    });
    await service.updateAgent(agent.id, {});
    expect(await service.deleteAgent(agent.id, 'owner')).toBe(true);
    expect(await service.deleteAgent(agent.id)).toBe(false);
    expect(await service.getAgent(agent.id)).toBeNull();
    await expect(service.updateAgent('missing', {})).rejects.toThrow('not found');
  });
  it('matches saved similar-message examples while rejecting irrelevant examples', async () => {
    const agent = await service.createAgent('owner', {
      name: 'Orders',
      systemPrompt: 'Order help',
      triggerKeywords: ['order-help'],
      similarMessages: ['checking customer order status'],
    });
    expect((await service.matchAgentForMessage('owner', 'customer order update'))?.id).toBe(agent.id);
    expect(await service.matchAgentForMessage('owner', 'weather today')).toBeNull();
    expect(await service.matchAgentForMessage('other', 'customer order update')).toBeNull();
  });
  it('limits CSV reports to the requested session and safely quotes optional captured fields', async () => {
    const captures = db.getRepository(AiQueryCapture);
    await captures.save(
      captures.create({
        sessionId: 'owner',
        agentId: 'agent',
        groupId: null,
        groupName: 'Team "A"',
        senderPhone: null,
        query: 'Where is my order?',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await captures.save(
      captures.create({ sessionId: 'other', agentId: 'other-agent', query: 'Private other customer question' }),
    );
    expect(await service.listQueryCaptures('owner')).toHaveLength(1);
    const csv = await service.exportQueryCapturesCsv('owner');
    expect(csv).toContain('"Team ""A"""');
    expect(csv).toContain('"2026-01-01T00:00:00.000Z","agent","","Team ""A""","","Where is my order?"');
    expect(csv).not.toContain('Private other customer');
    const noCaptureStore = new AiBotService(db.getRepository(AiBotConfig), db.getRepository(AiAgent));
    expect(await noCaptureStore.listQueryCaptures('owner')).toEqual([]);
  });
  it('keeps missing OAuth connection errors sanitized across setup, callback and disconnect', async () => {
    const connections = new StudioConnectionService(db.getRepository(StudioConnection));
    await expect(connections.startOAuth('owner', 'missing', 'actor')).rejects.toThrow('OAuth setup failed');
    await expect(
      connections.completeOAuth('owner', 'missing', 'actor', {
        state: 'fixture',
        code: 'private-fixture-code',
        iss: 'https://untrusted.example.test',
      }),
    ).rejects.toThrow('OAuth callback failed');
    await expect(connections.disconnectOAuth('owner', 'missing')).rejects.toThrow('OAuth connection changed');
    await expect(connections.remove('other', 'missing')).rejects.toThrow('Connection not found');
  });
  it('transforms nested lead delivery settings and rejects invalid nested downloads on create and update', async () => {
    const settings = {
      name: 'Lead flow',
      triggers: ['hello'],
      completionMessage: 'Saved',
      steps: [
        {
          key: 'choice',
          question: 'Choose',
          options: ['Guide'],
          deliveries: [{ option: 'Guide', type: 'link', url: 'https://example.test/guide' }],
        },
      ],
      completionMedia: [{ type: 'document', url: 'https://example.test/guide.pdf', filename: 'Guide.pdf' }],
    };
    for (const dto of [plainToInstance(CreateLeadFlowDto, settings), plainToInstance(UpdateLeadFlowDto, settings)]) {
      expect(dto.steps![0]).toBeInstanceOf(LeadFlowStepDto);
      expect(dto.steps![0].deliveries![0]).toBeInstanceOf(LeadFlowChoiceDeliveryDto);
      expect(dto.completionMedia![0]).toBeInstanceOf(LeadFlowCompletionMediaDto);
      dto.steps![0].deliveries![0].url = 'javascript:alert(1)';
      expect((await validate(dto)).some(error => error.property === 'steps')).toBe(true);
    }
  });
});

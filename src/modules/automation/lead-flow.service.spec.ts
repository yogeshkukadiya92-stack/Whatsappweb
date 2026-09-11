import { DataSource } from 'typeorm';
import { LeadFlowService } from './lead-flow.service';
import { LeadFlow } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('LeadFlowService', () => {
  let ds: DataSource;
  let service: LeadFlowService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, LeadFlow, LeadEntry],
      synchronize: true,
    });
    await ds.initialize();

    const sessions = ds.getRepository(Session);
    await sessions.save(
      sessions.create({ id: 'sess1', name: 'sess1', status: SessionStatus.READY, config: {} }),
    );

    service = new LeadFlowService(
      ds.getRepository(LeadFlow),
      ds.getRepository(LeadEntry),
    );
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates and retrieves lead flows', async () => {
    const flow = await service.createFlow('sess1', {
      name: 'Inquiry Flow',
      triggers: ['inquiry', 'hello', 'hi'],
      steps: [
        { key: 'name', question: 'What is your name?' },
        { key: 'city', question: 'What is your city?' },
      ],
      completionMessage: 'Thank you {{name}} from {{city}}!',
    });

    expect(flow.id).toBeDefined();
    expect(flow.name).toBe('Inquiry Flow');

    const all = await service.findAllFlows('sess1');
    expect(all.length).toBe(1);
    expect(all[0].triggers).toEqual(['inquiry', 'hello', 'hi']);
  });

  it('progresses through flow steps until completion', async () => {
    await service.createFlow('sess1', {
      name: 'Test Flow',
      triggers: ['hi'],
      steps: [
        { key: 'name', question: 'Name?' },
        { key: 'phone', question: 'Phone?' },
      ],
      completionMessage: 'Done {{name}} with {{phone}}!',
    });

    // 1. Initial trigger -> starts flow, returns step 1 question
    const res1 = await service.handleInbound('sess1', 'user1@c.us', 'hi');
    expect(res1.handled).toBe(true);
    expect(res1.replyText).toBe('Name?');

    // 2. Answer step 1 -> stores name, returns step 2 question
    const res2 = await service.handleInbound('sess1', 'user1@c.us', 'Ramesh');
    expect(res2.handled).toBe(true);
    expect(res2.replyText).toBe('Phone?');

    // 3. Answer step 2 -> stores phone, finishes flow, returns interpolated completion
    const res3 = await service.handleInbound('sess1', 'user1@c.us', '9876543210');
    expect(res3.handled).toBe(true);
    expect(res3.replyText).toBe('Done Ramesh with 9876543210!');

    // Verify lead entry in database
    const leads = await service.findAllLeads('sess1');
    expect(leads.length).toBe(1);
    expect(leads[0].status).toBe('completed');
    expect(leads[0].collectedData).toEqual({
      name: 'Ramesh',
      phone: '9876543210',
    });

    // Test CSV export
    const csv = await service.exportLeadsCsv('sess1');
    expect(csv).toContain('user1@c.us');
    expect(csv).toContain('Ramesh');
    expect(csv).toContain('9876543210');
  });

  it('ignores unrelated messages if no flow matches', async () => {
    const res = await service.handleInbound('sess1', 'user2@c.us', 'random text');
    expect(res.handled).toBe(false);
  });
});

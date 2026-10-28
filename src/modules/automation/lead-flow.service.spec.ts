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
    await sessions.save([
      sessions.create({ id: 'sess1', name: 'sess1', status: SessionStatus.READY, config: {} }),
      sessions.create({ id: 'sess2', name: 'sess2', status: SessionStatus.READY, config: {} }),
    ]);

    service = new LeadFlowService(ds.getRepository(LeadFlow), ds.getRepository(LeadEntry));
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

  it('keeps uploaded completion attachments ready for WhatsApp sending', async () => {
    await service.createFlow('sess1', {
      name: 'Brochure Flow',
      triggers: ['brochure'],
      steps: [{ key: 'name', question: 'Name?' }],
      completionMessage: 'Thanks {{name}}!',
      completionMedia: [
        {
          type: 'document',
          url: '',
          base64: 'data:application/pdf;base64,JVBERi0xLjQ=',
          mimetype: 'application/pdf',
          filename: 'brochure.pdf',
          caption: 'brochure.pdf',
        },
      ],
    });

    await service.handleInbound('sess1', 'pdf-user@c.us', 'brochure');
    const completed = await service.handleInbound('sess1', 'pdf-user@c.us', 'Ramesh');

    expect(completed.replyText).toBe('Thanks Ramesh!');
    expect(completed.completionMedia).toEqual([
      {
        type: 'document',
        url: '',
        base64: 'data:application/pdf;base64,JVBERi0xLjQ=',
        mimetype: 'application/pdf',
        filename: 'brochure.pdf',
        caption: 'brochure.pdf',
      },
    ]);
  });

  it('returns selectable options with option-based questions', async () => {
    await service.createFlow('sess1', {
      name: 'Service picker',
      triggers: ['service'],
      steps: [
        { key: 'service', question: 'Which service?', options: ['Website', 'Mobile app'] },
        { key: 'name', question: 'Your name?' },
      ],
      completionMessage: 'Thanks!',
    });

    const started = await service.handleInbound('sess1', 'picker@c.us', 'service');
    expect(started).toEqual({
      handled: true,
      replyText: 'Which service?',
      replyOptions: ['Website', 'Mobile app'],
    });

    const advanced = await service.handleInbound('sess1', 'picker@c.us', 'Website');
    expect(advanced).toEqual({ handled: true, replyText: 'Your name?', replyOptions: undefined });
  });

  it('triggers flow on any session when defined on another session (multi-session support)', async () => {
    // Flow created on sess1
    await service.createFlow('sess1', {
      name: 'Global Lead Flow',
      triggers: ['inquiry'],
      steps: [{ key: 'service', question: 'Which service do you need?' }],
      completionMessage: 'Got it!',
    });

    // Inbound message arrives on sess2 (different session)
    const res = await service.handleInbound('sess2', 'customer99@c.us', 'inquiry');
    expect(res.handled).toBe(true);
    expect(res.replyText).toBe('Which service do you need?');

    // Querying all flows via 'all'
    const allFlows = await service.findAllFlows('all');
    expect(allFlows.length).toBe(1);
    expect(allFlows[0].name).toBe('Global Lead Flow');
  });

  it('ignores unrelated messages if no flow matches', async () => {
    const res = await service.handleInbound('sess1', 'user2@c.us', 'random text');
    expect(res.handled).toBe(false);
  });
  it.each([
    ['PDF', 'document', 'https://example.com/guide.pdf'],
    ['Video', 'video', 'https://example.com/lesson.mp4'],
    ['Website', 'link', 'https://example.com/course'],
  ] as const)('delivers only the selected %s resource and completes the flow', async (option, type, url) => {
    const flow = await service.createFlow('sess1', {
      name: 'Resource menu',
      triggers: ['resources'],
      completionMessage: 'Generic completion',
      completionMedia: [{ type: 'document', url: 'https://example.com/unrelated.pdf' }],
      steps: [
        {
          key: 'resource',
          question: 'What would you like?',
          options: ['PDF', 'Video', 'Website'],
          deliveries: [
            { option: 'PDF', type: 'document', url: 'https://example.com/guide.pdf', filename: 'guide.pdf' },
            { option: 'Video', type: 'video', url: 'https://example.com/lesson.mp4' },
            { option: 'Website', type: 'link', url: 'https://example.com/course' },
          ],
        },
        { key: 'name', question: 'Unused question?' },
      ],
    });
    expect((await service.findOneFlow('sess1', flow.id)).steps[0].deliveries).toHaveLength(3);
    await service.handleInbound('sess1', 'resource@c.us', 'resources');
    const result = await service.handleInbound('sess1', 'resource@c.us', option.toLowerCase());
    if (type === 'link') {
      expect(result.replyText).toBe(url);
      expect(result.completionMedia).toEqual([]);
    } else {
      expect(result.completionMedia).toHaveLength(1);
      expect(result.completionMedia?.[0]).toMatchObject({ type, url });
    }
    const [entry] = await service.findAllLeads('sess1');
    expect(entry.status).toBe('completed');
    expect(entry.collectedData).toEqual({ resource: option });
    expect((await service.handleInbound('sess1', 'resource@c.us', option)).handled).toBe(false);
  });

  it('repeats the menu without advancing on an invalid selection', async () => {
    await service.createFlow('sess1', {
      name: 'Menu',
      triggers: ['menu'],
      completionMessage: 'Done',
      steps: [
        {
          key: 'choice',
          question: 'Choose',
          options: ['PDF', 'Video'],
          deliveries: [{ option: 'PDF', type: 'document', url: 'https://example.com/a.pdf' }],
        },
      ],
    });
    await service.handleInbound('sess1', 'invalid@c.us', 'menu');
    expect(await service.handleInbound('sess1', 'invalid@c.us', 'Other')).toMatchObject({
      replyText: 'Choose',
      replyOptions: ['PDF', 'Video'],
    });
    const [entry] = await service.findAllLeads('sess1');
    expect(entry.currentStepIndex).toBe(0);
    expect(entry.collectedData).toEqual({});
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'bad-url'])('rejects unsafe resource URL %s', async url => {
    await expect(
      service.createFlow('sess1', {
        name: 'Menu',
        triggers: ['menu'],
        completionMessage: 'Done',
        steps: [
          {
            key: 'choice',
            question: 'Choose',
            options: ['PDF', 'Video'],
            deliveries: [{ option: 'PDF', type: 'document', url }],
          },
        ],
      }),
    ).rejects.toThrow('Delivery URLs must use HTTP or HTTPS');
  });

  it('rejects delivery mappings to nonexistent options when updating', async () => {
    const flow = await service.createFlow('sess1', {
      name: 'Menu',
      triggers: ['menu'],
      completionMessage: 'Done',
      steps: [{ key: 'choice', question: 'Choose', options: ['PDF', 'Video'] }],
    });
    await expect(
      service.updateFlow('sess1', flow.id, {
        steps: [
          {
            key: 'choice',
            question: 'Choose',
            options: ['PDF', 'Video'],
            deliveries: [{ option: 'Other', type: 'link', url: 'https://example.com' }],
          },
        ],
      }),
    ).rejects.toThrow('Each delivery must match a unique choice');
    expect((await service.findOneFlow('sess1', flow.id)).steps[0].deliveries).toBeUndefined();
  });

  it('claims a resource once when two answers arrive concurrently', async () => {
    await service.createFlow('sess1', {
      name: 'Menu',
      triggers: ['menu'],
      completionMessage: 'Done',
      steps: [
        {
          key: 'choice',
          question: 'Choose',
          options: ['PDF', 'Video'],
          deliveries: [{ option: 'PDF', type: 'document', url: 'https://example.com/a.pdf' }],
        },
      ],
    });
    await service.handleInbound('sess1', 'concurrent@c.us', 'menu');
    const answers = await Promise.all([
      service.handleInbound('sess1', 'concurrent@c.us', 'PDF'),
      service.handleInbound('sess1', 'concurrent@c.us', 'PDF'),
    ]);
    expect(answers.filter(answer => answer.completionMedia?.length)).toHaveLength(1);
  });

  it('does not deliver a resource from a flow that was disabled after the menu was sent', async () => {
    const flow = await service.createFlow('sess1', {
      name: 'Menu',
      triggers: ['menu'],
      completionMessage: 'Done',
      steps: [
        {
          key: 'choice',
          question: 'Choose',
          options: ['PDF', 'Video'],
          deliveries: [{ option: 'PDF', type: 'document', url: 'https://example.com/a.pdf' }],
        },
      ],
    });
    await service.handleInbound('sess1', 'disabled@c.us', 'menu');
    await service.updateFlow('sess1', flow.id, { enabled: false });
    expect(await service.handleInbound('sess1', 'disabled@c.us', 'PDF')).toEqual({ handled: false });
  });
});

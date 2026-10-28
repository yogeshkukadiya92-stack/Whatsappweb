import { DataSource } from 'typeorm';
import { createHmac } from 'crypto';
import { CloudMenuService } from './cloud-menu.service';
import { CloudMenuConnection, CloudMenuReceipt } from './entities/cloud-menu.entity';
import { LeadFlowService } from './lead-flow.service';
import { LeadFlow } from './entities/lead-flow.entity';
import { LeadEntry } from './entities/lead-entry.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { AddCloudResourceMenus1792840000000 } from '../../database/migrations/1792840000000-AddCloudResourceMenus';

describe('Native Business API resource menus', () => {
  let ds: DataSource;
  let service: CloudMenuService;
  let flows: LeadFlowService;
  let fetchMock: jest.SpyInstance;
  let connectionId: string;
  let flowId: string;
  const previousVault = process.env.STUDIO_VAULT_KEY;
  const credentials = { accessToken: 'test-access-token', appSecret: 'test-app-secret' };
  const phone = '1234567890';
  const sender = '919876543210';
  interface WireRequest {
    type: string;
    interactive: { action: { buttons: Array<{ reply: { id: string; title: string } }> } };
  }
  let requests: WireRequest[];

  beforeEach(async () => {
    process.env.STUDIO_VAULT_KEY = Buffer.alloc(32, 8).toString('base64');
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, CloudMenuConnection, CloudMenuReceipt, LeadFlow, LeadEntry],
      synchronize: true,
    });
    await ds.initialize();
    for (const id of ['session1', 'session2'])
      await ds.getRepository(Session).save({ id, name: id, status: SessionStatus.READY, config: {} });
    service = new CloudMenuService(
      ds.getRepository(CloudMenuConnection),
      ds.getRepository(CloudMenuReceipt),
      ds.getRepository(LeadFlow),
    );
    flows = new LeadFlowService(ds.getRepository(LeadFlow), ds.getRepository(LeadEntry));
    const settings = await service.save('session1', {
      phoneNumberId: phone,
      apiVersion: 'v23.0',
      enabled: true,
      ...credentials,
    });
    connectionId = settings.webhookPath!.split('/').pop()!;
    const flow = await flows.createFlow('session1', {
      name: 'Menu',
      triggers: ['info'],
      completionMessage: 'unused',
      steps: [
        {
          key: 'resource',
          question: 'Choose a resource',
          nativeButtons: true,
          options: ['PDF', 'Video', 'Website'],
          deliveries: [
            { option: 'PDF', type: 'document', url: 'https://example.com/a.pdf', filename: 'guide.pdf' },
            { option: 'Video', type: 'video', url: 'https://example.com/a.mp4', caption: 'Your video' },
            { option: 'Website', type: 'link', url: 'https://example.com/course', caption: 'Open here' },
          ],
        },
      ],
    });
    flowId = flow.id;
    requests = [];
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((url, options) => {
      expect(url).toBe(`https://graph.facebook.com/v23.0/${phone}/messages`);
      expect((options?.headers as Record<string, string>).Authorization).toBe(`Bearer ${credentials.accessToken}`);
      requests.push(JSON.parse(options!.body as string) as WireRequest);
      return Promise.resolve(
        new Response(JSON.stringify({ messages: [{ id: `out-${requests.length}` }] }), { status: 200 }),
      );
    });
  });
  afterEach(async () => {
    fetchMock.mockRestore();
    await ds.destroy();
    if (previousVault === undefined) delete process.env.STUDIO_VAULT_KEY;
    else process.env.STUDIO_VAULT_KEY = previousVault;
  });
  function message(id: string, body = 'info') {
    return { id, from: sender, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } };
  }
  function raw(messages: unknown[], phoneNumberId = phone) {
    return Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages } }] }],
      }),
    );
  }
  function receive(messages: unknown[], phoneNumberId = phone) {
    const body = raw(messages, phoneNumberId);
    return service.receive(
      connectionId,
      `sha256=${createHmac('sha256', credentials.appSecret).update(body).digest('hex')}`,
      body,
    );
  }
  async function select(index: number, overrides: Record<string, unknown> = {}) {
    const buttons = requests[0].interactive.action.buttons;
    return receive([
      {
        ...message(`click-${index}`),
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: buttons[index].reply.id } },
        context: { id: 'out-1' },
        ...overrides,
      },
    ]);
  }

  it.each([0, 1, 2])('sends native buttons and the selected resource %i with the official wire shape', async index => {
    await receive([message('start')]);
    expect(requests[0]).toMatchObject({
      messaging_product: 'whatsapp',
      to: sender,
      type: 'interactive',
      interactive: { type: 'button', body: { text: 'Choose a resource' } },
    });
    expect(requests[0].interactive.action.buttons).toHaveLength(3);
    await select(index);
    if (index === 0)
      expect(requests[1]).toMatchObject({
        type: 'document',
        document: { link: 'https://example.com/a.pdf', filename: 'guide.pdf' },
      });
    if (index === 1)
      expect(requests[1]).toMatchObject({
        type: 'video',
        video: { link: 'https://example.com/a.mp4', caption: 'Your video' },
      });
    if (index === 2)
      expect(requests[1]).toMatchObject({ type: 'text', text: { body: 'Open here\nhttps://example.com/course' } });
    await select(index);
    expect(requests).toHaveLength(2);
  });

  it('encrypts credentials at rest and returns no credentials in connection settings', async () => {
    const rows = await ds.query<Array<{ secret: string }>>('SELECT secret FROM cloud_menu_connections');
    expect(rows[0].secret).not.toContain(credentials.accessToken);
    expect(rows[0].secret).not.toContain(credentials.appSecret);
    expect(JSON.stringify(await service.settings('session1'))).not.toContain('test-');
    expect((await service.settings('session2')).configured).toBe(false);
    await service.save('session1', { phoneNumberId: phone, apiVersion: 'v23.0', enabled: true });
    await receive([message('preserved')]);
    expect(requests).toHaveLength(1);
  });

  it('validates the subscription challenge and rotates verification tokens', async () => {
    const { verifyToken } = await service.rotateToken('session1');
    expect(await service.verify(connectionId, 'subscribe', verifyToken, '12345')).toBe('12345');
    await expect(service.verify(connectionId, 'subscribe', 'wrong', '12345')).rejects.toThrow(
      'Webhook verification failed',
    );
    await service.rotateToken('session1');
    await expect(service.verify(connectionId, 'subscribe', verifyToken, '12345')).rejects.toThrow(
      'Webhook verification failed',
    );
  });

  it('rejects missing, forged, or tampered signatures before sending', async () => {
    const body = raw([message('bad')]);
    const signature = `sha256=${createHmac('sha256', credentials.appSecret).update(body).digest('hex')}`;
    await expect(service.receive(connectionId, '', body)).rejects.toThrow('signature required');
    await expect(service.receive(connectionId, signature, Buffer.concat([body, Buffer.from(' ')]))).rejects.toThrow(
      'signature invalid',
    );
    expect(requests).toHaveLength(0);
    expect(await ds.getRepository(CloudMenuReceipt).count()).toBe(0);
  });

  it('ignores another phone, other session flows, old incoming messages and disabled connections', async () => {
    await receive([message('wrong-phone')], '9999999999');
    await receive([{ ...message('old'), timestamp: '1' }]);
    await flows.updateFlow('session1', flowId, { triggers: ['other'] });
    await flows.createFlow('session2', {
      name: 'Other session',
      triggers: ['info'],
      completionMessage: '',
      steps: [
        {
          key: 'a',
          question: 'Private',
          options: ['PDF', 'Video'],
          nativeButtons: true,
          deliveries: [
            { option: 'PDF', type: 'link', url: 'https://example.com/private' },
            { option: 'Video', type: 'link', url: 'https://example.com/private' },
          ],
        },
      ],
    });
    await receive([message('other-session')]);
    await service.save('session1', { phoneNumberId: phone, apiVersion: 'v23.0', enabled: false });
    await receive([message('disabled', 'other')]);
    expect(requests).toHaveLength(0);
  });

  it('deduplicates incoming starts and accepts only one resource per menu', async () => {
    await receive([message('start')]);
    await receive([message('start')]);
    await select(0);
    await select(1);
    expect(requests).toHaveLength(2);
  });

  it.each(['sender', 'context', 'revision', 'disabled'])('rejects a selection with wrong %s binding', async kind => {
    await receive([message('start')]);
    if (kind === 'revision') await flows.updateFlow('session1', flowId, { name: 'Changed menu' });
    if (kind === 'disabled') await flows.updateFlow('session1', flowId, { enabled: false });
    await select(
      0,
      kind === 'sender' ? { from: '919999999999' } : kind === 'context' ? { context: { id: 'wrong-menu' } } : {},
    );
    expect(requests).toHaveLength(1);
  });

  it('allows Meta to retry a failed delivery without delivering the other choices', async () => {
    await receive([message('start')]);
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 500 })));
    await expect(select(0)).rejects.toThrow('could not send');
    await select(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].type).toBe('document');
    const rows = await ds.getRepository(CloudMenuReceipt).find();
    expect(rows.every(row => row.status === 'done')).toBe(true);
  });

  it('rejects unsupported native menu titles and missing resource mappings', async () => {
    await expect(
      flows.updateFlow('session1', flowId, {
        steps: [
          {
            key: 'a',
            question: 'Choose',
            nativeButtons: true,
            options: ['Long label beyond twenty characters', 'Video'],
            deliveries: [],
          },
        ],
      }),
    ).rejects.toThrow('Native buttons need');
  });

  it('migrates the Cloud API tables and rolls them back on SQLite', async () => {
    const migrationDb = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [] });
    await migrationDb.initialize();
    await migrationDb.query('CREATE TABLE sessions (id varchar PRIMARY KEY)');
    const q = migrationDb.createQueryRunner();
    const migration = new AddCloudResourceMenus1792840000000();
    await migration.up(q);
    await migration.up(q);
    expect(await q.hasTable('cloud_menu_connections')).toBe(true);
    expect(await q.hasTable('cloud_menu_receipts')).toBe(true);
    await migration.down(q);
    expect(await q.hasTable('cloud_menu_receipts')).toBe(false);
    await q.release();
    await migrationDb.destroy();
  });
});

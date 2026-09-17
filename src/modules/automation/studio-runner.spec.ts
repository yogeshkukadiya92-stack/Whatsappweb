import { DataSource } from 'typeorm';
import { AddAutomationStudio1786800000000 } from '../../database/migrations/1786800000000-AddAutomationStudio';
import { StudioDefinition } from './entities/studio-workflow.entity';
import { matchesStudioTrigger, renderStudioText, runStudioDefinition } from './studio-runner';
import { withSafeFetch } from '../../common/security/ssrf-guard';
jest.mock('../../common/security/ssrf-guard', () => ({
  ...jest.requireActual<typeof import('../../common/security/ssrf-guard')>('../../common/security/ssrf-guard'),
  withSafeFetch: jest.fn(),
}));
const base: StudioDefinition = { keywords: ['order'], audience: 'direct', cooldownSeconds: 60, steps: [] };
describe('Automation Studio runner', () => {
  it('matches keywords without answering unrelated or excluded group messages', () => {
    expect(matchesStudioTrigger(base, 'My ORDER status?', '123@c.us')).toBe(true);
    expect(matchesStudioTrigger(base, 'hello', '123@c.us')).toBe(false);
    expect(matchesStudioTrigger(base, 'order', '123@g.us')).toBe(false);
  });
  it('matches specific numbers audience and rejects unlisted numbers or groups', () => {
    const numWorkflow: StudioDefinition = {
      keywords: ['help'],
      audience: 'specific_numbers',
      targetChats: ['+91 98765 43210', '919811111111'],
      cooldownSeconds: 60,
      steps: [],
    };
    expect(matchesStudioTrigger(numWorkflow, 'need help', '919876543210@c.us')).toBe(true);
    expect(matchesStudioTrigger(numWorkflow, 'need help', '919811111111@s.whatsapp.net')).toBe(true);
    expect(matchesStudioTrigger(numWorkflow, 'need help', '919899999999@c.us')).toBe(false);
    expect(matchesStudioTrigger(numWorkflow, 'need help', '919876543210@g.us')).toBe(false);
    expect(matchesStudioTrigger({ ...numWorkflow, targetChats: [] }, 'need help', '919876543210@c.us')).toBe(false);
  });
  it('matches specific groups audience and rejects unlisted groups or direct chats', () => {
    const grpWorkflow: StudioDefinition = {
      keywords: ['announcement'],
      audience: 'specific_groups',
      targetChats: ['120363024829392@g.us'],
      cooldownSeconds: 60,
      steps: [],
    };
    expect(matchesStudioTrigger(grpWorkflow, 'new announcement', '120363024829392@g.us')).toBe(true);
    expect(matchesStudioTrigger(grpWorkflow, 'new announcement', '120363999999999@g.us')).toBe(false);
    expect(matchesStudioTrigger(grpWorkflow, 'new announcement', '120363024829392@c.us')).toBe(false);
    expect(matchesStudioTrigger({ ...grpWorkflow, targetChats: [] }, 'new announcement', '120363024829392@g.us')).toBe(false);
  });
  it('matches every message when keywords array is empty or contains blank whitespace strings', () => {
    expect(matchesStudioTrigger({ ...base, keywords: [] }, 'any message at all', '123@c.us')).toBe(true);
    expect(matchesStudioTrigger({ ...base, keywords: [''] }, 'any message at all', '123@c.us')).toBe(true);
    expect(matchesStudioTrigger({ ...base, keywords: ['   ', ''] }, 'any message at all', '123@c.us')).toBe(true);
  });
  it('resolves nested API data and fails rather than emitting missing variables', () => {
    expect(renderStudioText('Order {{ api.order.id }}', { api: { order: { id: 42 } } })).toBe('Order 42');
    expect(() => renderStudioText('{{api.missing}}', { api: {} })).toThrow('not available');
  });
  it('stops at a failed filter without sending a reply', async () => {
    const send = jest.fn();
    const result = await runStudioDefinition(
      {
        ...base,
        steps: [
          {
            id: 'filter',
            label: 'Order filter',
            type: 'filter',
            config: { value: '{{message}}', operator: 'equals', expected: 'order' },
          },
          { id: 'reply', label: 'Reply', type: 'reply', config: { text: 'Sent' } },
        ],
      },
      'hello',
      '123@c.us',
      send,
    );
    expect(result.status).toBe('stopped');
    expect(send).not.toHaveBeenCalled();
    expect(result.trace).toHaveLength(1);
  });
  it('fetches API data, maps variables and previews replies without a send callback', async () => {
    (withSafeFetch as jest.Mock).mockImplementation(
      (_url: string, _init: unknown, use: (response: Response) => Promise<unknown>) =>
        use(new Response(JSON.stringify({ title: 'Order ready' }), { status: 200 })),
    );
    const result = await runStudioDefinition(
      {
        ...base,
        steps: [
          {
            id: 'http',
            label: 'Lookup',
            type: 'http',
            config: { url: 'https://example.com/api', method: 'GET', output: 'api' },
          },
          { id: 'var', label: 'Summary', type: 'variable', config: { name: 'summary', value: '{{api.title}}' } },
          { id: 'reply', label: 'Reply', type: 'reply', config: { text: '{{summary}}' } },
        ],
      },
      'order',
      'test@c.us',
    );
    expect(result.status).toBe('success');
    expect(result.replies).toEqual(['Order ready']);
    expect(result.trace).toHaveLength(3);
  });
  it('captures a failed send and does not continue downstream', async () => {
    const send = jest.fn().mockRejectedValue(new Error('WhatsApp disconnected'));
    const result = await runStudioDefinition(
      { ...base, steps: [{ id: 'r', type: 'reply', label: 'Reply', config: { text: 'Hello' } }] },
      'order',
      '1@c.us',
      send,
    );
    expect(result.status).toBe('failed');
    expect(result.replies).toEqual([]);
  });
  it('rejects HTTP URLs before fetching and bounds large API responses', async () => {
    const run = (url: string) =>
      runStudioDefinition(
        { ...base, steps: [{ id: 'h', type: 'http', label: 'Fetch', config: { url, method: 'GET', output: 'api' } }] },
        'order',
        'test@c.us',
      );
    expect((await run('http://example.com')).status).toBe('failed');
    (withSafeFetch as jest.Mock).mockImplementation(
      (_url: string, _init: unknown, use: (response: Response) => Promise<unknown>) =>
        use(new Response('x'.repeat(262145))),
    );
    expect((await run('https://example.com')).trace[0].output).toContain('256 KB');
  });
  it('parses calendar dates and generates universal Google Calendar events with Meet links', async () => {
    const send = jest.fn();
    const result = await runStudioDefinition(
      {
        ...base,
        steps: [
          {
            id: 'gcal',
            type: 'google_calendar',
            label: 'Create Meeting',
            config: {
              action: 'create_event',
              summary: 'Client Demo: {{message}}',
              startTime: 'tomorrow 3pm',
              durationMinutes: '45',
              description: 'Meeting with chat {{chatId}}',
              location: 'Google Meet',
              output: 'meeting',
            },
          },
          {
            id: 'reply',
            type: 'reply',
            label: 'Send confirmation',
            config: {
              text: 'Meeting confirmed: {{meeting.summary}} at {{meeting.start}}. Link: {{meeting.htmlLink}} Meet: {{meeting.meetLink}}',
            },
          },
        ],
      },
      'Product Demo',
      '919876543210@c.us',
      send,
    );
    expect(result.status).toBe('success');
    expect(send).toHaveBeenCalledTimes(1);
    const sentMsg = send.mock.calls[0][0];
    expect(sentMsg).toContain('Meeting confirmed: Client Demo: Product Demo');
    expect(sentMsg).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
    expect(sentMsg).toContain('https://meet.google.com/');
  });
});
describe('Automation Studio migration', () => {
  it('creates both SQLite tables idempotently and can revert', async () => {
    const source = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await source.initialize();
    const q = source.createQueryRunner();
    try {
      await q.query('CREATE TABLE "sessions" ("id" varchar PRIMARY KEY)');
      const migration = new AddAutomationStudio1786800000000();
      await migration.up(q);
      await migration.up(q);
      expect(await q.hasTable('studio_workflows')).toBe(true);
      expect(await q.hasTable('studio_executions')).toBe(true);
      await migration.down(q);
      expect(await q.hasTable('studio_workflows')).toBe(false);
    } finally {
      await q.release();
      await source.destroy();
    }
  });
});

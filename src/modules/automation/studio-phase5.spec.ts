import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { AiBotConfig } from './entities/ai-bot-config.entity';
import { StudioConnection } from './entities/studio-connection.entity';
import { StudioWorkflow, StudioExecution, StudioJob } from './entities/studio-workflow.entity';
import { StudioAiService } from './studio-ai.service';
import { StudioConnectionService } from './studio-connection.service';
import { StudioDraft, StudioPlannerService, parseStudioDraft, studioPromptUrls } from './studio-planner.service';
import { withSafeFetch } from '../../common/security/ssrf-guard';
jest.mock('../../common/security/ssrf-guard', () => ({
  ...jest.requireActual<typeof import('../../common/security/ssrf-guard')>('../../common/security/ssrf-guard'),
  withSafeFetch: jest.fn(),
}));
const urls = ['https://example.com/'];
const fixture = (): StudioDraft => ({
  name: 'Website answer',
  explanation: 'Read the website and answer the incoming question.',
  warnings: [],
  definition: {
    keywords: ['info'],
    audience: 'direct',
    cooldownSeconds: 60,
    trigger: { type: 'whatsapp' },
    steps: [
      {
        id: 'site',
        type: 'website',
        label: 'Read source',
        config: { url: urls[0], output: 'site', mode: 'auto', maxChars: '20000' },
      },
      {
        id: 'ai',
        type: 'ai',
        label: 'Answer',
        config: {
          task: 'answer',
          input: '{{site.text}}',
          question: '{{message}}',
          instructions: 'Use only source facts.',
          language: 'Gujarati',
          output: 'answer',
        },
      },
      { id: 'reply', type: 'reply', label: 'Reply', config: { text: '{{answer}}' } },
    ],
  },
});
const connection = {
  id: 'approved',
  sessionId: 'session',
  name: 'QA',
  kind: 'mcp',
  baseUrl: 'https://tools.example/mcp',
  auth: 'none',
  headerName: '',
  enabled: true,
  allowedTools: ['lookup'],
} as StudioConnection;
describe('AI workflow draft validation', () => {
  it('returns a normalized review-only draft using an explicitly supplied website', () => {
    const result = parseStudioDraft(JSON.stringify(fixture()), urls, []);
    expect(result.definition.steps).toHaveLength(3);
    expect(result.warnings).toHaveLength(1);
    expect(result).not.toHaveProperty('enabled');
  });
  it('extracts explicit HTTPS URLs but not credentials or dynamic hosts', () => {
    expect(
      studioPromptUrls(
        'Read https://example.com and https://example.com/. Never use https://u:password@example.com/ or http://private/ or https://{{host}}/',
      ),
    ).toEqual(urls);
  });
  it.each(['bad JSON', '[]', 'null', '{"enabled":true}'])('rejects malformed/unexpected draft %s', text => {
    expect(() => parseStudioDraft(text, urls, [])).toThrow();
  });
  it.each([
    'url',
    'post',
    'credentials',
    'schedule',
    'group',
    'duplicate',
    'backward',
    'too-many',
    'blank-keyword',
    'cooldown',
  ] as const)('rejects unsafe draft %s', scenario => {
    const draft = fixture();
    if (scenario === 'url') draft.definition.steps[0].config.url = 'https://invented.example/';
    if (scenario === 'post')
      draft.definition.steps[0] = {
        id: 'site',
        type: 'http',
        label: 'Write',
        config: { url: urls[0], method: 'POST', output: 'site' },
      };
    if (scenario === 'credentials') draft.definition.steps[0].config.apiKey = 'hidden-secret';
    if (scenario === 'schedule')
      draft.definition.trigger = { type: 'schedule', chatId: '777@c.us', intervalMinutes: 5 };
    if (scenario === 'group') draft.definition.audience = 'groups';
    if (scenario === 'duplicate') draft.definition.steps[1].id = 'site';
    if (scenario === 'backward') draft.definition.steps[1].config.next = 'site';
    if (scenario === 'too-many')
      draft.definition.steps = Array.from({ length: 7 }, (_, i) => ({
        id: `s${i}`,
        type: 'reply',
        label: 'Reply',
        config: { text: 'Hi' },
      }));
    if (scenario === 'blank-keyword') draft.definition.keywords = [''];
    if (scenario === 'cooldown') draft.definition.cooldownSeconds = 10;
    expect(() => parseStudioDraft(JSON.stringify(draft), urls, [])).toThrow();
  });
  it('accepts only selected connections and explicitly approved tools', () => {
    const draft = fixture();
    draft.definition.steps = [
      {
        id: 'tool',
        type: 'mcp',
        label: 'Lookup',
        config: { connectionId: connection.id, tool: 'lookup', arguments: '{"query":"{{message}}"}', output: 'result' },
      },
      { id: 'reply', type: 'reply', label: 'Reply', config: { text: '{{result.text}}' } },
    ];
    expect(() => parseStudioDraft(JSON.stringify(draft), [], [connection])).not.toThrow();
    expect(() => parseStudioDraft(JSON.stringify(draft), [], [])).toThrow('unapproved connection');
    expect(() => parseStudioDraft(JSON.stringify(draft), [], [{ ...connection, enabled: false }])).toThrow();
    draft.definition.steps[0].config.tool = 'delete';
    expect(() => parseStudioDraft(JSON.stringify(draft), [], [connection])).toThrow('unapproved MCP');
    draft.definition.steps[0].config.tool = 'lookup';
    draft.definition.steps[0].config.arguments = '[]';
    expect(() => parseStudioDraft(JSON.stringify(draft), [], [connection])).toThrow('must be an object');
  });
  it('rejects a connected API path that escapes its approved scope', () => {
    const draft = fixture();
    draft.definition.steps[0] = {
      id: 'site',
      type: 'http',
      label: 'Read',
      config: { connectionId: connection.id, path: '../secret', method: 'GET', output: 'site' },
    };
    expect(() =>
      parseStudioDraft(JSON.stringify(draft), [], [{ ...connection, kind: 'api', baseUrl: 'https://api.example/v1/' }]),
    ).toThrow('traversal');
  });
});
describe('AI workflow planning with actual session AI configuration', () => {
  let db: DataSource;
  let planner: StudioPlannerService;
  let sessionId: string;
  beforeEach(async () => {
    jest.clearAllMocks();
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, AiBotConfig, StudioConnection, StudioWorkflow, StudioExecution, StudioJob],
      synchronize: true,
    });
    await db.initialize();
    sessionId = (await db.getRepository(Session).save({ name: 'QA', status: SessionStatus.READY, config: {} })).id;
    await db
      .getRepository(AiBotConfig)
      .save({ sessionId, enabled: false, provider: 'openai', model: 'qa-model', apiKey: 'qa-private-key' });
    planner = new StudioPlannerService(
      new StudioAiService(db.getRepository(AiBotConfig)),
      new StudioConnectionService(db.getRepository(StudioConnection)),
    );
  });
  afterEach(async () => {
    await db.destroy();
  });
  const prompt = 'Read https://example.com/ and answer info questions in Gujarati.';
  function respond(draft: StudioDraft | string = fixture()) {
    (withSafeFetch as jest.Mock).mockImplementation(
      (_url: string, _init: unknown, use: (response: Response) => unknown) =>
        use(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: typeof draft === 'string' ? draft : JSON.stringify(draft) },
                },
              ],
            }),
          ),
        ),
    );
  }
  it('uses JSON mode with separated instructions, without saving jobs or workflows', async () => {
    respond();
    const result = await planner.generate(sessionId, { prompt });
    expect(result.name).toBe('Website answer');
    const calls = (withSafeFetch as jest.Mock).mock.calls as [
      string,
      { body: string; headers: Record<string, string> },
      unknown,
    ][];
    const body = JSON.parse(calls[0][1].body) as {
      messages: { role: string; content: string }[];
      response_format: { type: string };
      max_completion_tokens: number;
    };
    expect(body.response_format.type).toBe('json_object');
    expect(body.max_completion_tokens).toBe(3000);
    expect(body.messages[0].content).not.toContain('qa-private-key');
    expect(body.messages[1].content).toContain(prompt);
    expect(calls[0][1].headers.Authorization).toBe('Bearer qa-private-key');
    for (const entity of [StudioWorkflow, StudioExecution, StudioJob])
      expect(await db.getRepository(entity).count()).toBe(0);
  });
  it('does not expose credentials, even in selected connection context', async () => {
    const selected = await db.getRepository(StudioConnection).save({
      sessionId,
      name: 'Billing',
      kind: 'api',
      allowedTools: [],
      baseUrl: 'https://api.example/v1/',
      auth: 'bearer',
      secret: 'ciphertext-not-for-provider',
      headerName: '',
      enabled: true,
    });
    respond();
    await planner.generate(sessionId, { prompt, connectionIds: [selected.id] });
    const calls = (withSafeFetch as jest.Mock).mock.calls as [string, { body: string }, unknown][];
    expect(calls[0][1].body).not.toContain('ciphertext-not-for-provider');
    expect(calls[0][1].body).toContain(selected.id);
  });
  it('fails before a paid request for unavailable connections or missing session credentials', async () => {
    await expect(planner.generate(sessionId, { prompt, connectionIds: ['other-session-id'] })).rejects.toThrow(
      'unavailable',
    );
    await expect(planner.generate('unknown', { prompt })).rejects.toThrow('credentials');
    expect(withSafeFetch).not.toHaveBeenCalled();
  });
  it('allows six attempts and rejects the seventh with HTTP 429', async () => {
    respond();
    for (let i = 0; i < 6; i++) await planner.generate(sessionId, { prompt });
    try {
      await planner.generate(sessionId, { prompt });
      throw new Error('Expected rate limit');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
    expect(withSafeFetch).toHaveBeenCalledTimes(6);
  });
  it('rejects concurrent generation and releases the lock after completion', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    let finish!: () => void;
    const wait = new Promise<void>(resolve => {
      finish = resolve;
    });
    (withSafeFetch as jest.Mock).mockImplementation(
      async (_url: string, _init: unknown, use: (response: Response) => unknown) => {
        entered();
        await wait;
        return use(
          new Response(
            JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture()) } }] }),
          ),
        );
      },
    );
    const first = planner.generate(sessionId, { prompt });
    await started;
    await expect(planner.generate(sessionId, { prompt })).rejects.toThrow('One generation');
    finish();
    await first;
    respond();
    await expect(planner.generate(sessionId, { prompt })).resolves.toHaveProperty('name');
  });
  it('rejects provider output safely without automatic retries or raw output disclosure', async () => {
    respond('private-secret malformed JSON');
    await expect(planner.generate(sessionId, { prompt })).rejects.not.toThrow('private-secret');
    expect(withSafeFetch).toHaveBeenCalledTimes(1);
    respond();
    await expect(planner.generate(sessionId, { prompt })).resolves.toHaveProperty('name');
  });
  it('rechecks connection permissions after generation completes', async () => {
    const approved = await db.getRepository(StudioConnection).save({ ...connection, id: randomUUID(), sessionId });
    const draft = fixture();
    draft.definition.steps = [
      {
        id: 'tool',
        type: 'mcp',
        label: 'Lookup',
        config: { connectionId: approved.id, tool: 'lookup', arguments: '{}', output: 'result' },
      },
      { id: 'reply', type: 'reply', label: 'Reply', config: { text: '{{result.text}}' } },
    ];
    (withSafeFetch as jest.Mock).mockImplementation(
      async (_url: string, _init: unknown, use: (response: Response) => unknown) => {
        await db.getRepository(StudioConnection).update({ id: approved.id }, { enabled: false });
        return use(
          new Response(
            JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }),
          ),
        );
      },
    );
    await expect(planner.generate(sessionId, { prompt, connectionIds: [approved.id] })).rejects.toThrow(
      'unapproved connection',
    );
  });
  it('supports Gemini JSON generation without placing its key in the URL', async () => {
    await db.getRepository(AiBotConfig).update({ sessionId }, { provider: 'gemini' });
    (withSafeFetch as jest.Mock).mockImplementation(
      (url: string, init: { headers: Record<string, string>; body: string }, use: (response: Response) => unknown) => {
        expect(url).not.toContain('qa-private-key');
        expect(init.headers['x-goog-api-key']).toBe('qa-private-key');
        const body = JSON.parse(init.body) as { generationConfig: { responseMimeType: string } };
        expect(body.generationConfig.responseMimeType).toBe('application/json');
        return use(
          new Response(
            JSON.stringify({
              candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(fixture()) }] } }],
            }),
          ),
        );
      },
    );
    expect((await planner.generate(sessionId, { prompt })).definition.steps).toHaveLength(3);
  });
});

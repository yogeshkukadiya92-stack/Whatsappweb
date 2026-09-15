import { DataSource } from 'typeorm';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { StudioConnection } from './entities/studio-connection.entity';
import { StudioConnectionService, studioConnectionUrl } from './studio-connection.service';
import { openStudioSecret, sealStudioSecret, studioVaultReady } from './studio-vault';
import { withSafeFetch } from '../../common/security/ssrf-guard';
import { advanceStudioState, createStudioState, runStudioDefinition } from './studio-runner';
import {
  StudioDefinition,
  StudioRunState,
  StudioWorkflow,
  StudioExecution,
  StudioJob,
} from './entities/studio-workflow.entity';
import { StudioWorkflowService } from './studio-workflow.service';
import { validateStudioDefinition } from './studio-validation';
import { AddStudioConnections1787000000000 } from '../../database/migrations/1787000000000-AddStudioConnections';
import { StudioConnectionController } from './studio-connection.controller';
import { REQUIRED_ROLE_KEY } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
jest.mock('../../common/security/ssrf-guard', () => ({
  ...jest.requireActual<typeof import('../../common/security/ssrf-guard')>('../../common/security/ssrf-guard'),
  withSafeFetch: jest.fn(),
}));
const oldKey = process.env.STUDIO_VAULT_KEY;
const key = Buffer.alloc(32, 42).toString('base64');
const fetchCalls = () =>
  (withSafeFetch as jest.Mock).mock.calls as [string, { headers: Record<string, string> }, unknown][];
const dto = {
  name: 'Billing',
  baseUrl: 'https://api.example.com/v1/',
  auth: 'bearer' as const,
  enabled: true,
  secret: 'fixture-secret',
};
beforeEach(() => {
  process.env.STUDIO_VAULT_KEY = key;
  jest.clearAllMocks();
});
afterAll(() => {
  if (oldKey === undefined) delete process.env.STUDIO_VAULT_KEY;
  else process.env.STUDIO_VAULT_KEY = oldKey;
});
describe('Studio vault and scope', () => {
  it('encrypts with a unique nonce and authenticated session/connection scope', () => {
    const a = sealStudioSecret('token', 'session:id');
    expect(a).not.toContain('token');
    expect(a).not.toEqual(sealStudioSecret('token', 'session:id'));
    expect(openStudioSecret(a, 'session:id')).toEqual('token');
    expect(() => openStudioSecret(a, 'other:id')).toThrow('cannot be decrypted');
    expect(() => openStudioSecret(a.replace('v1', 'v2'), 'session:id')).toThrow();
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => openStudioSecret(parts.join('.'), 'session:id')).toThrow();
    process.env.STUDIO_VAULT_KEY = Buffer.alloc(32, 43).toString('base64');
    expect(() => openStudioSecret(a, 'session:id')).toThrow();
  });
  it('fails closed without a valid stable deployment key', () => {
    delete process.env.STUDIO_VAULT_KEY;
    expect(studioVaultReady()).toBe(false);
    expect(() => sealStudioSecret('token', 'scope')).toThrow();
    process.env.STUDIO_VAULT_KEY = 'bad';
    expect(studioVaultReady()).toBe(false);
  });
  it.each([
    '../secret',
    '%2e%2e/secret',
    '%252e%252e/secret',
    '//evil.example',
    'https://evil.example',
    '/outside',
    'a\\b',
    'a#fragment',
  ])('rejects escaping path %s', path => {
    expect(() => studioConnectionUrl(dto.baseUrl, path)).toThrow();
  });
  it.each([
    'http://api.example.com/',
    'https://user:pass@api.example.com/',
    'https://api.example.com:8443/',
    'https://api.example.com/?token=x',
  ])('rejects unsafe base %s', base => {
    expect(() => studioConnectionUrl(base, 'item')).toThrow();
  });
  it('preserves the approved base path and supports a relative query', () => {
    expect(studioConnectionUrl('https://api.example.com/v1', 'orders/1?expand=true')).toBe(
      'https://api.example.com/v1/orders/1?expand=true',
    );
  });
  it('requires administrators for credential mutations and discovery', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLE_KEY, StudioConnectionController)).toBe(ApiKeyRole.OPERATOR);
    for (const method of ['create', 'update', 'remove', 'tools'] as const)
      expect(
        Reflect.getMetadata(
          REQUIRED_ROLE_KEY,
          Object.getOwnPropertyDescriptor(StudioConnectionController.prototype, method)?.value as object,
        ),
      ).toBe(ApiKeyRole.ADMIN);
  });
});
describe('Studio connected requests', () => {
  let db: DataSource;
  let service: StudioConnectionService;
  let sessionId: string;
  beforeEach(async () => {
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, StudioConnection, StudioWorkflow, StudioExecution, StudioJob],
      synchronize: true,
    });
    await db.initialize();
    sessionId = (await db.getRepository(Session).save({ name: 'QA', status: SessionStatus.READY, config: {} })).id;
    service = new StudioConnectionService(db.getRepository(StudioConnection));
  });
  afterEach(async () => {
    await db.destroy();
  });
  function response(data: unknown) {
    (withSafeFetch as jest.Mock).mockImplementation((_url: string, _init: unknown, use: (res: Response) => unknown) =>
      use(new Response(JSON.stringify(data))),
    );
  }
  it('returns metadata only and encrypts at rest, preserving omitted credentials', async () => {
    const connection = await service.save(sessionId, dto);
    expect(connection.secret).toBeUndefined();
    expect(JSON.stringify(await service.list(sessionId))).not.toContain('fixture-secret');
    const row = await db.getRepository(StudioConnection).createQueryBuilder('c').addSelect('c.secret').getOneOrFail();
    expect(row.secret).toMatch(/^v1\./);
    await service.save(sessionId, { ...dto, name: 'Renamed', secret: undefined }, connection.id);
    response({ price: 500 });
    expect(await service.request(sessionId, connection.id, 'prices')).toEqual({ price: 500 });
    expect(fetchCalls()[0][0]).toBe('https://api.example.com/v1/prices');
    expect(fetchCalls()[0][1].headers.Authorization).toBe('Bearer fixture-secret');
  });
  it('requires fresh credentials for origin/auth changes', async () => {
    const connection = await service.save(sessionId, dto);
    await expect(
      service.save(sessionId, { ...dto, secret: undefined, baseUrl: 'https://evil.example/' }, connection.id),
    ).rejects.toThrow('fresh credential');
  });
  it('blocks cross-session access and disabled connections without fetching', async () => {
    const connection = await service.save(sessionId, dto);
    await expect(service.request('other', connection.id, 'prices')).rejects.toThrow('unavailable');
    await expect(service.save('other', dto, connection.id)).rejects.toThrow('not found');
    await service.save(sessionId, { ...dto, secret: undefined, enabled: false }, connection.id);
    await expect(service.request(sessionId, connection.id, 'prices')).rejects.toThrow('disabled');
    expect(withSafeFetch).not.toHaveBeenCalled();
  });
  it('allows public connections without a vault key and clears stored credentials', async () => {
    const connection = await service.save(sessionId, dto);
    delete process.env.STUDIO_VAULT_KEY;
    await service.save(sessionId, { ...dto, auth: 'none', secret: undefined }, connection.id);
    response({ ok: true });
    expect(await service.request(sessionId, connection.id, 'probe')).toEqual({ ok: true });
    expect(fetchCalls()[0][1].headers.Authorization).toBeUndefined();
  });
  it('does not expose provider errors or echoed credentials', async () => {
    const connection = await service.save(sessionId, dto);
    response({ token: dto.secret });
    await expect(service.request(sessionId, connection.id, 'probe')).rejects.toThrow('Connected API request failed');
    (withSafeFetch as jest.Mock).mockRejectedValue(new Error('secret https://private/?token=fixture-secret'));
    await expect(service.request(sessionId, connection.id, 'probe')).rejects.not.toThrow('fixture-secret');
  });
  it.each(['apiKey', 'basic'] as const)('supports %s authentication', async auth => {
    const connection = await service.save(sessionId, {
      ...dto,
      auth,
      headerName: 'X-API-Key',
      secret: auth === 'basic' ? 'user:pass' : dto.secret,
    });
    response({ ok: true });
    await service.request(sessionId, connection.id, 'probe');
    const headers = fetchCalls()[0][1].headers;
    expect(auth === 'basic' ? headers.Authorization : headers['X-API-Key']).toBe(
      auth === 'basic' ? 'Basic dXNlcjpwYXNz' : dto.secret,
    );
  });
  it('uses the actual MCP SDK for initialize/list/call and excludes write tools', async () => {
    const connection = await service.save(sessionId, {
      ...dto,
      kind: 'mcp',
      baseUrl: 'https://tools.example/mcp',
      allowedTools: ['lookup', 'delete'],
    });
    const methods: string[] = [];
    (withSafeFetch as jest.Mock).mockImplementation(
      (
        _url: string,
        init: { method: string; body: string; headers: Record<string, string> },
        use: (res: Response) => unknown,
      ) => {
        expect(init.headers.authorization).toBe(`Bearer ${dto.secret}`);
        if (init.method === 'DELETE') {
          methods.push('session/terminate');
          return use(new Response(null, { status: 204 }));
        }
        const rpc = JSON.parse(init.body) as { id?: string; method: string };
        methods.push(rpc.method);
        if (!('id' in rpc)) return use(new Response(null, { status: 202 }));
        const result =
          rpc.method === 'initialize'
            ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'QA', version: '1.0' } }
            : rpc.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'lookup',
                      inputSchema: { type: 'object' },
                      annotations: { readOnlyHint: true, destructiveHint: false },
                    },
                    { name: 'delete', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
                  ],
                }
              : { content: [{ type: 'text', text: 'Price ₹500' }] };
        return use(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), {
            headers: { 'content-type': 'application/json', 'mcp-session-id': 'qa-session' },
          }),
        );
      },
    );
    expect(await service.mcp(sessionId, connection.id)).toEqual([expect.objectContaining({ name: 'lookup' })]);
    expect(await service.mcp(sessionId, connection.id, 'lookup', { query: 'price' })).toEqual({ text: 'Price ₹500' });
    expect(methods).toContain('session/terminate');
    await expect(service.mcp(sessionId, connection.id, 'unknown')).rejects.toThrow('not approved');
    const before = methods.filter(method => method === 'tools/call').length;
    await expect(service.mcp(sessionId, connection.id, 'delete')).rejects.toThrow('MCP request failed');
    expect(methods.filter(method => method === 'tools/call')).toHaveLength(before);
    const studio = new StudioWorkflowService(
      db.getRepository(StudioWorkflow),
      db.getRepository(StudioExecution),
      db.getRepository(StudioJob),
      undefined,
      undefined,
      service,
    );
    await studio.save(sessionId, {
      name: 'MCP durable',
      enabled: true,
      definition: {
        keywords: ['price'],
        audience: 'direct',
        cooldownSeconds: 60,
        steps: [
          {
            id: 'tool',
            type: 'mcp',
            label: 'Lookup',
            config: {
              connectionId: connection.id,
              tool: 'lookup',
              arguments: '{"query":"{{message}}"}',
              output: 'result',
            },
          },
          { id: 'reply', type: 'reply', label: 'Reply', config: { text: '{{result.text}}' } },
        ],
      },
    });
    await studio.inbound(sessionId, 'price', '777@c.us');
    const send = jest.fn().mockResolvedValue(undefined);
    await studio.processDue(send);
    await studio.processDue(send);
    expect(send).toHaveBeenCalledWith(sessionId, '777@c.us', 'Price ₹500');
    expect((await studio.logs(sessionId))[0].status).toBe('success');
    await studio.inbound(sessionId, 'price', '888@c.us');
    await service.save(
      sessionId,
      { ...dto, kind: 'mcp', baseUrl: connection.baseUrl, allowedTools: ['lookup'], secret: undefined, enabled: false },
      connection.id,
    );
    await studio.processDue(send);
    expect((await studio.logs(sessionId)).find(log => log.chatId === '888@c.us')?.status).toBe('failed');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['binary', 'error', 'pagination', 'stream'] as const)(
    'rejects unsupported MCP %s responses',
    async scenario => {
      const connection = await service.save(sessionId, {
        ...dto,
        kind: 'mcp',
        baseUrl: 'https://tools.example/mcp',
        allowedTools: ['lookup'],
      });
      (withSafeFetch as jest.Mock).mockImplementation(
        (_url: string, init: { body: string }, use: (res: Response) => unknown) => {
          const rpc = JSON.parse(init.body) as { id?: string; method: string };
          if (!('id' in rpc)) return use(new Response(null, { status: 202 }));
          if (scenario === 'stream')
            return use(new Response('data: unsupported', { headers: { 'content-type': 'text/event-stream' } }));
          const result =
            rpc.method === 'initialize'
              ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'QA', version: '1' } }
              : rpc.method === 'tools/list'
                ? {
                    tools: [{ name: 'lookup', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
                    ...(scenario === 'pagination' ? { nextCursor: 'next' } : {}),
                  }
                : scenario === 'binary'
                  ? { content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }] }
                  : { isError: true, content: [{ type: 'text', text: 'private provider error' }] };
          return use(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), {
              headers: { 'content-type': 'application/json' },
            }),
          );
        },
      );
      await expect(service.mcp(sessionId, connection.id, 'lookup')).rejects.toThrow('MCP request failed');
    },
  );
  it('migration is idempotent, supports CRUD and cascades session deletion', async () => {
    const q = db.createQueryRunner();
    const migration = new AddStudioConnections1787000000000();
    await migration.down(q);
    await migration.up(q);
    await migration.up(q);
    await service.save(sessionId, dto);
    await db.getRepository(Session).delete(sessionId);
    expect(await db.getRepository(StudioConnection).count()).toBe(0);
    await migration.down(q);
    await q.release();
  });
});
describe('Studio connection runner', () => {
  const d: StudioDefinition = {
    keywords: ['price'],
    audience: 'direct',
    cooldownSeconds: 60,
    steps: [
      {
        id: 'api',
        type: 'http',
        label: 'Read',
        config: { connectionId: 'id', path: 'prices?q={{message}}', method: 'GET', output: 'api' },
      },
      { id: 'reply', type: 'reply', label: 'Reply', config: { text: '{{api.price}}' } },
    ],
  };
  it('runs connected GET and renders output without putting a secret in definitions', async () => {
    validateStudioDefinition(d);
    const connection = jest.fn().mockResolvedValue({ price: 500 });
    const result = await runStudioDefinition(d, 'demo', 'test@c.us', undefined, undefined, undefined, connection);
    expect(connection).toHaveBeenCalledWith('id', 'prices?q=demo');
    expect(result.replies).toEqual(['500']);
  });
  it('rejects connected POST and invalid MCP input', async () => {
    expect(() =>
      validateStudioDefinition({ ...d, steps: [{ ...d.steps[0], config: { ...d.steps[0].config, method: 'POST' } }] }),
    ).toThrow();
    const mcp: StudioDefinition = {
      ...d,
      steps: [
        {
          id: 'tool',
          type: 'mcp',
          label: 'Tool',
          config: { connectionId: 'id', tool: 'lookup', arguments: '[]', output: 'result' },
        },
      ],
    };
    const invoke = jest.fn();
    const result = await advanceStudioState(mcp, createStudioState('hi', 'test@c.us'), { mcp: invoke });
    expect(result.status).toBe('failed');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('interpolates customer text without JSON argument injection and bounds call attempts', async () => {
    const mcp: StudioDefinition = {
      ...d,
      steps: [
        {
          id: 'tool',
          type: 'mcp',
          label: 'Tool',
          config: {
            connectionId: 'id',
            tool: 'lookup',
            arguments: '{"query":"{{message}}","limit":5}',
            output: 'result',
          },
        },
      ],
    };
    const message = 'price", "delete": true, "query": "oops';
    const invoke = jest.fn().mockResolvedValue({ text: 'safe' });
    const state = createStudioState(message, 'test@c.us');
    expect((await advanceStudioState(mcp, state, { mcp: invoke })).status).toBe('success');
    expect(invoke).toHaveBeenCalledWith('id', 'lookup', { query: message, limit: 5 });
    const capped = createStudioState(message, 'test@c.us');
    capped.mcpCalls = 10;
    expect((await advanceStudioState(mcp, capped, { mcp: invoke })).status).toBe('failed');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('checkpoints before MCP invocation and refuses uncertain replay', async () => {
    const mcp: StudioDefinition = {
      ...d,
      steps: [
        {
          id: 'tool',
          type: 'mcp',
          label: 'Tool',
          config: { connectionId: 'id', tool: 'lookup', arguments: '{}', output: 'result' },
        },
      ],
    };
    const state = createStudioState('hi', 'test@c.us');
    let snapshot = '';
    const invoke = jest.fn().mockResolvedValue({ text: 'answer' });
    expect(
      (
        await advanceStudioState(mcp, state, {
          mcp: invoke,
          beforeSend: async () => {
            await Promise.resolve();
            snapshot = JSON.stringify(state);
          },
        })
      ).status,
    ).toBe('success');
    expect((JSON.parse(snapshot) as StudioRunState).sending).toBe(true);
    expect((await advanceStudioState(mcp, JSON.parse(snapshot) as StudioRunState, { mcp: invoke })).status).toBe(
      'failed',
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

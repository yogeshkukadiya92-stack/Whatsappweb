import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { StudioConnection } from './entities/studio-connection.entity';
import { StudioWorkflow, StudioExecution, StudioJob } from './entities/studio-workflow.entity';
import { CFL_OAUTH, oauthHash, parseCflTokenResponse, StudioOAuth } from './studio-oauth';
import { StudioConnectionService } from './studio-connection.service';
import { StudioConnectionController } from './studio-connection.controller';
import { REQUIRED_ROLE_KEY } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { openStudioSecret, sealStudioSecret } from './studio-vault';
import { withSafeFetch } from '../../common/security/ssrf-guard';

jest.mock('../../common/security/ssrf-guard', () => ({
  ...jest.requireActual<typeof import('../../common/security/ssrf-guard')>('../../common/security/ssrf-guard'),
  withSafeFetch: jest.fn(),
}));
const oldKey = process.env.STUDIO_VAULT_KEY;
const oldEnabled = process.env.STUDIO_CFL_OAUTH_ENABLED;
const issued = () => ({
  token_type: 'Bearer',
  scope: 'cfl:read',
  expires_in: 900,
  access_token: 'a'.repeat(43),
  refresh_token: 'r'.repeat(43),
});
let db: DataSource;
let oauth: StudioOAuth;
let service: StudioConnectionService;
let sessionId: string;
let id: string;
const secret = async () =>
  (
    await db
      .getRepository(StudioConnection)
      .createQueryBuilder('c')
      .addSelect('c.secret')
      .where('c.id = :id', { id })
      .getOneOrFail()
  ).secret!;
const saved = async () => JSON.parse(openStudioSecret(await secret(), `${sessionId}:${id}`));
const write = async (value: unknown) =>
  db.getRepository(StudioConnection).update(
    { id },
    {
      secret: sealStudioSecret(JSON.stringify(value), `${sessionId}:${id}`),
    },
  );
const mockToken = () =>
  (withSafeFetch as jest.Mock).mockImplementation(async (_url: string, _init: unknown, use: (r: Response) => unknown) =>
    use(Response.json(issued())),
  );
beforeEach(async () => {
  jest.clearAllMocks();
  process.env.STUDIO_VAULT_KEY = Buffer.alloc(32, 42).toString('base64');
  process.env.STUDIO_CFL_OAUTH_ENABLED = 'true';
  db = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [Session, StudioConnection, StudioWorkflow, StudioExecution, StudioJob],
    synchronize: true,
  });
  await db.initialize();
  sessionId = (await db.getRepository(Session).save({ name: 'Synthetic QA', status: SessionStatus.READY, config: {} }))
    .id;
  service = new StudioConnectionService(db.getRepository(StudioConnection));
  id = (
    await service.save(sessionId, {
      name: 'CFL QA',
      kind: 'mcp',
      allowedTools: ['list_datasets', 'browse_records'],
      baseUrl: CFL_OAUTH.resource,
      auth: 'oauth',
      enabled: true,
    })
  ).id;
  oauth = new StudioOAuth(db.getRepository(StudioConnection));
});
afterEach(async () => {
  await db.destroy();
});
afterAll(() => {
  if (oldKey === undefined) delete process.env.STUDIO_VAULT_KEY;
  else process.env.STUDIO_VAULT_KEY = oldKey;
  if (oldEnabled === undefined) delete process.env.STUDIO_CFL_OAUTH_ENABLED;
  else process.env.STUDIO_CFL_OAUTH_ENABLED = oldEnabled;
});
it('requires ADMIN and route-param session scope for every OAuth mutation', () => {
  for (const method of ['startOAuth', 'completeOAuth', 'disconnectOAuth'])
    expect(
      Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        (StudioConnectionController.prototype as unknown as Record<string, object>)[method],
      ),
    ).toBe(ApiKeyRole.ADMIN);
});
it('fails closed without explicit enablement, a stable key or an approved endpoint/tool scope', async () => {
  delete process.env.STUDIO_CFL_OAUTH_ENABLED;
  await expect(oauth.start(sessionId, id, 'admin')).rejects.toThrow('enablement');
  process.env.STUDIO_CFL_OAUTH_ENABLED = 'true';
  delete process.env.STUDIO_VAULT_KEY;
  await expect(oauth.start(sessionId, id, 'admin')).rejects.toThrow('enablement');
  process.env.STUDIO_VAULT_KEY = Buffer.alloc(32, 42).toString('base64');
  await expect(
    service.save(sessionId, {
      name: 'Bad',
      kind: 'mcp',
      allowedTools: [],
      auth: 'oauth',
      enabled: true,
      baseUrl: 'https://evil.example/mcp',
    }),
  ).rejects.toThrow('approved');
  await expect(
    service.save(sessionId, {
      name: 'Bad',
      kind: 'mcp',
      allowedTools: ['write'],
      auth: 'oauth',
      enabled: true,
      baseUrl: CFL_OAUTH.resource,
    }),
  ).rejects.toThrow('read-only');
});
it('never returns or accepts manually entered OAuth tokens', async () => {
  const result = await service.list(sessionId);
  expect(JSON.stringify(result)).not.toContain('stateHash');
  expect(JSON.stringify(result)).not.toContain('"secret"');
  await expect(
    service.save(
      sessionId,
      {
        name: 'Bad',
        kind: 'mcp',
        allowedTools: [],
        auth: 'oauth',
        enabled: true,
        baseUrl: CFL_OAUTH.resource,
        secret: 'manual-token',
      },
      id,
    ),
  ).rejects.toThrow('manually');
});
it('creates session/connection/admin-bound encrypted state and S256 PKCE', async () => {
  const result = new URL((await oauth.start(sessionId, id, 'admin-stamp')).authorizationUrl);
  const pending = (await saved()).pending;
  expect(result.origin).toBe(CFL_OAUTH.issuer);
  expect(result.searchParams.get('redirect_uri')).toBe(CFL_OAUTH.redirectUri);
  expect(result.searchParams.get('resource')).toBe(CFL_OAUTH.resource);
  expect(result.searchParams.get('code_challenge')).toBe(oauthHash(pending.verifier));
  expect(result.searchParams.get('code_challenge_method')).toBe('S256');
  expect(pending.actor).toBe('admin-stamp');
  expect(await secret()).not.toContain(pending.verifier);
});
it.each(['state', 'issuer', 'actor', 'session', 'expired'])(
  'rejects mismatched %s before token transmission',
  async scenario => {
    const url = new URL((await oauth.start(sessionId, id, 'admin')).authorizationUrl);
    const callback = { state: url.searchParams.get('state')!, iss: CFL_OAUTH.issuer, code: 'c'.repeat(43) };
    if (scenario === 'state') callback.state += 'x';
    if (scenario === 'issuer') callback.iss = 'https://evil.example';
    if (scenario === 'expired') {
      const value = await saved();
      value.pending.expires = 0;
      await write(value);
    }
    await expect(
      oauth.complete(
        scenario === 'session' ? randomUUID() : sessionId,
        id,
        scenario === 'actor' ? 'other-admin' : 'admin',
        callback,
      ),
    ).rejects.toThrow();
    expect(withSafeFetch).not.toHaveBeenCalled();
  },
);
it('denial consumes pending state without creating tokens or making external calls', async () => {
  const url = new URL((await oauth.start(sessionId, id, 'admin')).authorizationUrl);
  expect(
    await oauth.complete(sessionId, id, 'admin', {
      state: url.searchParams.get('state')!,
      iss: CFL_OAUTH.issuer,
      error: 'access_denied',
    }),
  ).toEqual({ connected: false, cancelled: true });
  expect(await saved()).toEqual({ v: 1 });
  expect(withSafeFetch).not.toHaveBeenCalled();
});
it('redeems once, binds exact redirect/resource/verifier and blocks callback replay', async () => {
  mockToken();
  const url = new URL((await oauth.start(sessionId, id, 'admin')).authorizationUrl);
  const pending = (await saved()).pending;
  const callback = { state: url.searchParams.get('state')!, iss: CFL_OAUTH.issuer, code: 'c'.repeat(43) };
  expect(await oauth.complete(sessionId, id, 'admin', callback)).toEqual({ connected: true });
  const params = new URLSearchParams((withSafeFetch as jest.Mock).mock.calls[0][1].body);
  expect(params.get('code_verifier')).toBe(pending.verifier);
  expect(params.get('redirect_uri')).toBe(CFL_OAUTH.redirectUri);
  expect(params.get('resource')).toBe(CFL_OAUTH.resource);
  expect(await oauth.credential(sessionId, id)).toBe(issued().access_token);
  await expect(oauth.complete(sessionId, id, 'admin', callback)).rejects.toThrow();
  expect(withSafeFetch).toHaveBeenCalledTimes(1);
});
it('atomically claims a rotating refresh across two concurrent workers', async () => {
  await write({ v: 1, tokens: { access: 'old'.repeat(20), refresh: 'refresh'.repeat(10), expires: 0 } });
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => {
    entered = resolve;
  });
  (withSafeFetch as jest.Mock).mockImplementation(
    async (_url: string, _init: unknown, use: (r: Response) => unknown) => {
      entered();
      await wait;
      return use(Response.json(issued()));
    },
  );
  const first = oauth.credential(sessionId, id);
  await ready;
  await expect(new StudioOAuth(db.getRepository(StudioConnection)).credential(sessionId, id)).rejects.toThrow(
    'progress',
  );
  release();
  expect(await first).toBe(issued().access_token);
  expect(withSafeFetch).toHaveBeenCalledTimes(1);
});
it('never retries an ambiguous one-use refresh and clears credentials on failure', async () => {
  await write({ v: 1, tokens: { access: 'a'.repeat(43), refresh: 'r'.repeat(43), expires: 0 } });
  (withSafeFetch as jest.Mock).mockRejectedValue(new Error('private response must not leak'));
  await expect(oauth.credential(sessionId, id)).rejects.toThrow('renewal failed');
  expect(await saved()).toEqual({ v: 1 });
  await expect(oauth.credential(sessionId, id)).rejects.toThrow('login');
  expect(withSafeFetch).toHaveBeenCalledTimes(1);
});
it('disconnect clears even disabled connections and attempts pinned upstream revocation', async () => {
  await write({ v: 1, tokens: { access: 'a'.repeat(43), refresh: 'r'.repeat(43), expires: Date.now() + 900000 } });
  await db.getRepository(StudioConnection).update({ id }, { enabled: false });
  (withSafeFetch as jest.Mock).mockRejectedValue(new Error('offline'));
  expect(await oauth.disconnect(sessionId, id)).toEqual({ connected: false });
  expect(await saved()).toEqual({ v: 1 });
  expect((withSafeFetch as jest.Mock).mock.calls[0][0]).toBe(`${CFL_OAUTH.issuer}/api/mcp-oauth/revoke`);
});
it('checks local revocation and expiry immediately before MCP requests', async () => {
  await write({ v: 1, tokens: { access: 'a'.repeat(43), refresh: 'r'.repeat(43), expires: Date.now() + 900000 } });
  await oauth.assertCredential(sessionId, id, 'a'.repeat(43));
  await write({ v: 1 });
  await expect(oauth.assertCredential(sessionId, id, 'a'.repeat(43))).rejects.toThrow('changed');
});
it.each([
  { ...issued(), scope: 'write' },
  { ...issued(), token_type: 'Basic' },
  { ...issued(), expires_in: 999999 },
  { ...issued(), access_token: 'bad\r\nheader' },
])('rejects malformed or over-scoped token replies', value => {
  expect(() => parseCflTokenResponse(value)).toThrow('Invalid');
});

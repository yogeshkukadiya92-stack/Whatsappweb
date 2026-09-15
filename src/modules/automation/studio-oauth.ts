import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { StudioConnection } from './entities/studio-connection.entity';
import { openStudioSecret, sealStudioSecret, studioVaultReady } from './studio-vault';
import { withSafeFetch } from '../../common/security/ssrf-guard';
import { readStudioResponse } from './studio-content';

// Explicit trust relationship: no dynamic issuers, registration, metadata URLs or client secrets.
export const CFL_OAUTH = {
  resource: 'https://dashboard.coachforlife.in/api/mcp',
  issuer: 'https://dashboard.coachforlife.in',
  redirectUri: 'https://wa.yogeshaihub.in/automation-studio',
  clientId: 'waply_studio',
  scope: 'cfl:read',
};
type Tokens = { access: string; refresh: string; expires: number };
type Pending = { stateHash: string; verifier: string; actor: string; expires: number };
type SavedOAuth = { v: 1; tokens?: Tokens; pending?: Pending; busy?: boolean };
export const oauthHash = (value: string) => createHash('sha256').update(value).digest('base64url');
export const studioOAuthReady = () => process.env.STUDIO_CFL_OAUTH_ENABLED === 'true' && studioVaultReady();
export function validateCflOAuth(connection: Pick<StudioConnection, 'kind' | 'baseUrl' | 'allowedTools'>) {
  if (!studioOAuthReady()) throw new Error('CFL OAuth requires administrator vault setup and explicit enablement.');
  if (connection.kind !== 'mcp' || connection.baseUrl !== CFL_OAUTH.resource)
    throw new Error('OAuth is supported only for the approved CFL Dashboard MCP endpoint.');
  if (connection.allowedTools.some(tool => !['list_datasets', 'browse_records'].includes(tool)))
    throw new Error('Only CFL read-only dataset tools may be approved.');
}
export function initialStudioOAuth() {
  if (!studioOAuthReady()) throw new Error('CFL OAuth requires administrator vault setup and explicit enablement.');
  return JSON.stringify({ v: 1 } satisfies SavedOAuth);
}
export function parseCflTokenResponse(value: unknown): Tokens {
  const data = value as Record<string, unknown> | null;
  const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{32,2048}$/.test(v);
  if (
    !data ||
    data.token_type !== 'Bearer' ||
    data.scope !== CFL_OAUTH.scope ||
    !token(data.access_token) ||
    !token(data.refresh_token) ||
    typeof data.expires_in !== 'number' ||
    !Number.isInteger(data.expires_in) ||
    data.expires_in < 1 ||
    data.expires_in > 900
  )
    throw new Error('Invalid CFL OAuth token response.');
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + data.expires_in * 1000 };
}

export class StudioOAuth {
  constructor(private readonly connections: Repository<StudioConnection>) {}
  private async load(sessionId: string, id: string, allowDisabled = false) {
    const connection = await this.connections
      .createQueryBuilder('c')
      .addSelect('c.secret')
      .where('c.id = :id AND c.sessionId = :sessionId', { id, sessionId })
      .getOne();
    if (!connection || connection.auth !== 'oauth' || (!allowDisabled && !connection.enabled))
      throw new Error('OAuth connection is unavailable or disabled.');
    validateCflOAuth(connection);
    return connection;
  }
  private read(connection: StudioConnection): SavedOAuth {
    if (!connection.secret) throw new Error('Reconnect CFL OAuth.');
    const value = JSON.parse(
      openStudioSecret(connection.secret, `${connection.sessionId}:${connection.id}`),
    ) as SavedOAuth;
    if (value.v !== 1) throw new Error('Reconnect CFL OAuth.');
    return value;
  }
  private async replace(connection: StudioConnection, value: SavedOAuth) {
    const secret = sealStudioSecret(JSON.stringify(value), `${connection.sessionId}:${connection.id}`);
    // Ciphertext compare-and-swap works on SQLite AND PostgreSQL, across processes. Never send a
    // one-use code/refresh token until this worker atomically owns its redemption.
    const result = await this.connections.update(
      { id: connection.id, sessionId: connection.sessionId, secret: connection.secret! },
      { secret },
    );
    if (result.affected !== 1) throw new Error('OAuth connection changed; retry or reconnect.');
    return { ...connection, secret };
  }
  private async token(params: Record<string, string>) {
    return withSafeFetch(
      `${CFL_OAUTH.issuer}/api/mcp-oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          ...params,
          client_id: CFL_OAUTH.clientId,
          resource: CFL_OAUTH.resource,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      },
      async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
        return parseCflTokenResponse(JSON.parse(await readStudioResponse(response, 16384)));
      },
    );
  }
  async start(sessionId: string, id: string, actor: string) {
    if (!actor) throw new Error('Administrator identity required.');
    const connection = await this.load(sessionId, id);
    const saved = this.read(connection);
    if (saved.busy) throw new Error('OAuth exchange is in progress; reconnect after it settles.');
    // Keep a still-live grant while the administrator reviews a replacement; denial changes none.
    const verifier = randomBytes(32).toString('base64url');
    const state = `${id}.${randomBytes(32).toString('base64url')}`;
    await this.replace(connection, {
      ...saved,
      pending: { stateHash: oauthHash(state), verifier, actor, expires: Date.now() + 300000 },
    });
    const url = new URL(`${CFL_OAUTH.issuer}/api/mcp-oauth/authorize`);
    url.search = new URLSearchParams({
      client_id: CFL_OAUTH.clientId,
      redirect_uri: CFL_OAUTH.redirectUri,
      response_type: 'code',
      resource: CFL_OAUTH.resource,
      scope: CFL_OAUTH.scope,
      state,
      code_challenge: oauthHash(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return { authorizationUrl: url.href };
  }
  async complete(
    sessionId: string,
    id: string,
    actor: string,
    callback: { state: string; code?: string; iss: string; error?: string },
  ) {
    const connection = await this.load(sessionId, id);
    const saved = this.read(connection);
    if (
      saved.busy ||
      !saved.pending ||
      saved.pending.expires <= Date.now() ||
      saved.pending.actor !== actor ||
      saved.pending.stateHash !== oauthHash(callback.state) ||
      callback.iss !== CFL_OAUTH.issuer ||
      !callback.state.startsWith(`${id}.`)
    )
      throw new Error('Invalid, expired or replayed OAuth callback.');
    if (callback.error === 'access_denied' && !callback.code) {
      await this.replace(connection, { v: 1, tokens: saved.tokens });
      return { connected: false, cancelled: true };
    }
    if (callback.error || !callback.code || !/^[A-Za-z0-9_-]{32,2048}$/.test(callback.code))
      throw new Error('Invalid OAuth callback.');
    const claimed = await this.replace(connection, { v: 1, busy: true });
    let issued: Tokens | undefined;
    try {
      const tokens = await this.token({
        grant_type: 'authorization_code',
        code: callback.code,
        redirect_uri: CFL_OAUTH.redirectUri,
        code_verifier: saved.pending.verifier,
      });
      issued = tokens;
      await this.replace(claimed, { v: 1, tokens });
      // Retire the replaced grant only AFTER successfully persisting the new grant.
      if (saved.tokens) await this.revoke(saved.tokens.refresh);
      return { connected: true };
    } catch {
      if (issued) await this.revoke(issued.refresh);
      await this.replace(claimed, { v: 1 }).catch(() => undefined);
      throw new Error('CFL OAuth exchange failed. Reconnect; no token will be replayed.');
    }
  }
  async credential(sessionId: string, id: string) {
    const connection = await this.load(sessionId, id);
    const saved = this.read(connection);
    if (saved.busy || !saved.tokens) throw new Error('CFL OAuth needs login or renewal is in progress.');
    if (saved.tokens.expires > Date.now() + 60000) return saved.tokens.access;
    const claimed = await this.replace(connection, { v: 1, busy: true });
    let issued: Tokens | undefined;
    try {
      const tokens = await this.token({ grant_type: 'refresh_token', refresh_token: saved.tokens.refresh });
      issued = tokens;
      await this.replace(claimed, { v: 1, tokens });
      return tokens.access;
    } catch {
      if (issued) await this.revoke(issued.refresh);
      // Network ambiguity is NOT a reason to retry a one-use refresh token: that revokes grants.
      await this.replace(claimed, { v: 1 }).catch(() => undefined);
      throw new Error('CFL OAuth renewal failed. Sign in again.');
    }
  }
  async assertCredential(sessionId: string, id: string, credential: string) {
    const saved = this.read(await this.load(sessionId, id));
    if (saved.busy || !saved.tokens || saved.tokens.access !== credential || saved.tokens.expires <= Date.now())
      throw new Error('OAuth credential changed or expired.');
  }
  private async revoke(token: string) {
    // Best effort upstream revocation; local access is cleared even if the issuer is unavailable.
    await withSafeFetch(
      `${CFL_OAUTH.issuer}/api/mcp-oauth/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: CFL_OAUTH.clientId }).toString(),
        signal: AbortSignal.timeout(10000),
      },
      response => {
        if (!response.ok) throw new Error();
      },
    ).catch(() => undefined);
  }
  async disconnect(sessionId: string, id: string) {
    const connection = await this.load(sessionId, id, true);
    const saved = this.read(connection);
    await this.replace(connection, { v: 1 });
    if (saved.tokens) await this.revoke(saved.tokens.refresh);
    return { connected: false };
  }
}

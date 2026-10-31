import { UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { User } from './entities/user.entity';
import { SupabaseAuthService } from './supabase-auth.service';

const originalEnv = process.env;
const originalFetch = global.fetch;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    SUPABASE_AUTH_URL: 'http://supabase-kong:8000',
    SUPABASE_ANON_KEY: 'public-anon-key',
  };
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('Supabase email authentication', () => {
  it('requires a server admin credential before making a provisioning request', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = jest.fn();
    await expect(new SupabaseAuthService().createUser('client@example.com', 'password123', 'Client')).rejects.toThrow(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates a confirmed user with the server credential and no session response', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'new-identity' }) });
    await expect(new SupabaseAuthService().createUser('client@example.com', 'password123', 'Client')).resolves.toEqual({
      id: 'new-identity',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://supabase-kong:8000/auth/v1/admin/users',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'server-secret', Authorization: 'Bearer server-secret' }) as unknown,
        body: JSON.stringify({
          email: 'client@example.com',
          password: 'password123',
          user_metadata: { name: 'Client' },
          email_confirm: true,
        }),
      }),
    );
  });

  it.each([false, true])('links the identity transactionally and rolls back on local failure (%s)', async fail => {
    const createUser = jest
      .spyOn(SupabaseAuthService.prototype, 'createUser')
      .mockResolvedValue({ id: 'new-identity' });
    const remove = jest.spyOn(SupabaseAuthService.prototype, 'deleteCreatedUser').mockResolvedValue();
    const manager = {
      create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
      save: jest.fn((entity: unknown, values: Record<string, unknown>) => {
        if (entity === ApiKey) return Promise.resolve({ ...values, id: 'key-id' });
        if (fail) throw new Error('database failure');
        return Promise.resolve({ ...values, id: 'user-id' });
      }),
    };
    const users = {
      findOne: jest.fn().mockResolvedValue(null),
      manager: {
        transaction: jest.fn((callback: (value: typeof manager) => Promise<unknown>) => callback(manager)),
      },
    };
    const auth = new AuthService(
      {} as Repository<ApiKey>,
      users as unknown as Repository<User>,
      {} as ApiKeyUsageTracker,
      {} as never,
    );
    Object.assign(auth, {
      moduleRef: {
        get: () => ({
          trial: () =>
            Promise.resolve({
              subscriptionStatus: 'trial',
              maxSessions: 1,
              subscriptionExpiresAt: new Date(Date.now() + 3 * 86400000),
            }),
        }),
      },
    });
    const result = auth.createAdminUser({ email: ' CLIENT@example.com ', name: ' Client ', password: 'password123' });
    if (fail) {
      await expect(result).rejects.toThrow('database failure');
      expect(remove).toHaveBeenCalledWith('new-identity');
    } else {
      await expect(result).resolves.toMatchObject({ email: 'client@example.com', apiKeyId: 'key-id', maxSessions: 1 });
      expect(remove).not.toHaveBeenCalled();
    }
    expect(createUser).toHaveBeenCalledWith('client@example.com', 'password123', 'Client');
    expect(manager.create).toHaveBeenCalledWith(
      ApiKey,
      expect.objectContaining({ supabaseUserId: 'new-identity', role: ApiKeyRole.OPERATOR }),
    );
  });

  it('keeps legacy public registration blocked in Supabase mode', async () => {
    const auth = new AuthService(
      {} as Repository<ApiKey>,
      {} as Repository<User>,
      {} as ApiKeyUsageTracker,
      {} as never,
    );
    await expect(
      auth.register({ email: 'client@example.com', name: 'Client', password: 'password123' }),
    ).rejects.toThrow('Use Supabase email signup');
  });

  it('validates a confirmed account with the Auth server and sends no service-role credential', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'supabase-user-1', email_confirmed_at: '2026-09-23T00:00:00Z' }),
    });
    global.fetch = fetchMock;

    await expect(new SupabaseAuthService().getUser('access-token')).resolves.toMatchObject({ id: 'supabase-user-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://supabase-kong:8000/auth/v1/user',
      expect.objectContaining({
        headers: {
          apikey: 'public-anon-key',
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        },
        redirect: 'error',
      }) as unknown,
    );
  });

  it('rejects an unconfirmed account even when the Auth server accepted its token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'unconfirmed', email_confirmed_at: null }),
    });
    await expect(new SupabaseAuthService().getUser('access-token')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects refresh sessions for unconfirmed accounts', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          user: { id: 'unconfirmed', email_confirmed_at: null },
        }),
    });
    await expect(new SupabaseAuthService().refresh('old-refresh-token')).rejects.toThrow(UnauthorizedException);
  });

  it('applies the linked Waply key role and session scope to Supabase tokens', async () => {
    jest.spyOn(SupabaseAuthService.prototype, 'getUser').mockResolvedValue({
      id: 'supabase-user-1',
      email_confirmed_at: '2026-09-23T00:00:00Z',
    });
    const key = {
      id: 'key-1',
      name: 'Operator',
      role: ApiKeyRole.OPERATOR,
      isActive: true,
      expiresAt: null,
      allowedIps: null,
      allowedSessions: ['session-1'],
      supabaseUserId: 'supabase-user-1',
    } as ApiKey;
    const findOne = jest.fn().mockResolvedValue(key);
    const repository = { findOne } as unknown as Repository<ApiKey>;
    const tracker = { record: jest.fn().mockResolvedValue(undefined) } as unknown as ApiKeyUsageTracker;
    const auth = new AuthService(repository, {} as Repository<User>, tracker, {} as never);

    await expect(auth.validateApiKey('eyJheader.payload.signature', '127.0.0.1', 'session-1')).resolves.toBe(key);
    await expect(auth.validateApiKey('eyJheader.payload.signature', '127.0.0.1', 'session-2')).rejects.toThrow(
      'not authorized for this session',
    );
    expect(findOne).toHaveBeenCalledWith({ where: { supabaseUserId: 'supabase-user-1' } });
  });
});

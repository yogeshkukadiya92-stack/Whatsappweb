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

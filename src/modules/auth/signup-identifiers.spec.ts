import { DataSource } from 'typeorm';
import { ModuleRef } from '@nestjs/core';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { User } from './entities/user.entity';
import { ApiKey } from './entities/api-key.entity';
import { normalizeLoginIdentifiers } from './login-identifiers';
import { SupabaseAuthService } from './supabase-auth.service';

const originalEnv = process.env;
const originalFetch = global.fetch;
afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

it('normalizes usernames and country-code mobile numbers', () => {
  expect(normalizeLoginIdentifiers({ username: ' Rahul.Test ', phone: '+91 (98765) 43210' })).toEqual({
    username: 'rahul.test',
    phone: '+919876543210',
  });
  expect(normalizeLoginIdentifiers({ username: '', phone: '' })).toEqual({});
});
it.each([{ username: '123456' }, { username: 'a@b.com' }, { phone: 'call-me' }, { phone: '+0123' }])(
  'rejects invalid registration identifiers %j',
  value => {
    expect(() => normalizeLoginIdentifiers(value)).toThrow();
  },
);

it('persists aliases and allows all three identifiers to sign in to the same local account', async () => {
  process.env = { ...originalEnv, SUPABASE_AUTH_URL: '', SUPABASE_ANON_KEY: '' };
  const db = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [User, ApiKey],
    synchronize: true,
  }).initialize();
  try {
    const users = db.getRepository(User);
    const auth = new AuthService(
      db.getRepository(ApiKey),
      users,
      { record: jest.fn() } as unknown as ApiKeyUsageTracker,
      { get: () => ({ trial: async () => ({ maxSessions: 1, subscriptionStatus: 'trial' }) }) } as unknown as ModuleRef,
    );
    const signup = await auth.register({
      name: 'Rahul',
      email: 'rahul@example.com',
      password: 'password123',
      username: 'Rahul.Test',
      phone: '+91 98765 43210',
    });
    expect(await users.findOneByOrFail({ id: signup.user.id })).toMatchObject({
      username: 'rahul.test',
      phone: '+919876543210',
    });
    for (const email of ['rahul@example.com', 'RAHUL.TEST', '+91 (98765) 43210']) {
      const result = await auth.userLogin({ email, password: 'password123' });
      expect(result.user.id).toBe(signup.user.id);
      expect(result.user.role).toBe('user');
    }
    for (const aliases of [{ username: 'RAHUL.TEST' }, { phone: '919876543210' }]) {
      await expect(
        auth.register({ name: 'Other', email: 'other@example.com', password: 'password123', ...aliases }),
      ).rejects.toThrow('already in use');
    }
    expect(await users.count()).toBe(1);
    await expect(auth.userLogin({ email: 'rahul.test', password: 'wrong' })).rejects.toThrow('Invalid login');
  } finally {
    await db.destroy();
  }
});

it.each(['createUser', 'signUp'] as const)(
  'stores normalized optional aliases in Supabase %s metadata',
  async operation => {
    process.env = {
      ...originalEnv,
      SUPABASE_AUTH_URL: 'http://auth.local',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'identity' }) });
    await new SupabaseAuthService()[operation]('user@example.com', 'password123', 'User', {
      username: 'New.User',
      phone: '+91 98765 43210',
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body);
    expect(body[operation === 'createUser' ? 'user_metadata' : 'data']).toEqual({
      name: 'User',
      username: 'new.user',
      phone: '+919876543210',
    });
  },
);

it('rejects a duplicate username before creating a Supabase identity', async () => {
  process.env = {
    ...originalEnv,
    SUPABASE_AUTH_URL: 'http://auth.local',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  };
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ users: [{ id: 'existing', user_metadata: { username: 'New.User' } }] }),
    });
  await expect(
    new SupabaseAuthService().createUser('user@example.com', 'password123', 'User', { username: 'new.user' }),
  ).rejects.toThrow('already in use');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('logs in by mobile number stored during email signup without claiming SMS verification', async () => {
  process.env = {
    ...originalEnv,
    SUPABASE_AUTH_URL: 'http://auth.local',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  };
  const user = {
    id: 'identity',
    email: 'user@example.com',
    email_confirmed_at: 'confirmed',
    user_metadata: { phone: '+919876543210' },
  };
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [user] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token', refresh_token: 'refresh', user }) });
  await expect(new SupabaseAuthService().signIn('+91 98765 43210', 'password123')).resolves.toMatchObject({
    access_token: 'token',
  });
  expect(global.fetch).toHaveBeenLastCalledWith(
    'http://auth.local/auth/v1/token?grant_type=password',
    expect.objectContaining({ body: JSON.stringify({ email: 'user@example.com', password: 'password123' }) }),
  );
});

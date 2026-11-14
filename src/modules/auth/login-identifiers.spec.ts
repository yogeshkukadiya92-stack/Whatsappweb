import { UnauthorizedException } from '@nestjs/common';
import { validate } from 'class-validator';
import { LoginUserDto, RegisterUserDto } from './dto/user-auth.dto';
import { SupabaseAuthService } from './supabase-auth.service';

const originalFetch = global.fetch;
const originalEnv = process.env;
afterEach(() => {
  global.fetch = originalFetch;
  process.env = originalEnv;
});

it.each(['admin-name', '+91 98765 43210', 'user@example.com'])('accepts login identifier %s', async email => {
  expect(await validate(Object.assign(new LoginUserDto(), { email, password: 'password' }))).toHaveLength(0);
});

it('still requires email for signup', async () => {
  expect(
    await validate(
      Object.assign(new RegisterUserDto(), { email: 'admin-name', password: 'password123', name: 'Admin' }),
    ),
  ).not.toHaveLength(0);
});

it.each(['admin-name', '+91 98765 43210'])('resolves %s then verifies the password with Supabase', async identifier => {
  process.env = {
    ...originalEnv,
    SUPABASE_AUTH_URL: 'http://auth.local',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  };
  const user = {
    id: 'admin',
    email: 'admin@example.com',
    phone: '+919876543210',
    user_metadata: { username: 'admin-name' },
    email_confirmed_at: 'confirmed',
  };
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [user] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token', refresh_token: 'refresh', user }) });
  await expect(new SupabaseAuthService().signIn(identifier, 'password')).resolves.toMatchObject({
    access_token: 'token',
  });
  expect(global.fetch).toHaveBeenLastCalledWith(
    'http://auth.local/auth/v1/token?grant_type=password',
    expect.objectContaining({ body: JSON.stringify({ email: user.email, password: 'password' }) }),
  );
});

it('rejects ambiguous usernames without attempting password login', async () => {
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
      json: async () => ({
        users: ['a', 'b'].map(id => ({ id, email: `${id}@example.com`, user_metadata: { username: 'same' } })),
      }),
    });
  await expect(new SupabaseAuthService().signIn('same', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each(['admin-name', '+91 98765 43210'])('resolves local identifier %s without changing role checks', async email => {
  const { AuthService } = await import('./auth.service');
  const users = { find: jest.fn().mockResolvedValue([{ id: 'admin', isActive: false }]) };
  const service = new AuthService({} as never, users as never, {} as never, { enabled: false } as never);
  await expect(service.userLogin({ email, password: 'password' })).rejects.toBeInstanceOf(UnauthorizedException);
  const query = users.find.mock.calls[0][0];
  expect(query.where).toContainEqual({ username: email });
  if (email.startsWith('+')) expect(query.where).toContainEqual({ phone: '+919876543210' });
});

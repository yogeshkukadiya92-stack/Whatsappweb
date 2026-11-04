import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { ApiKey } from './entities/api-key.entity';
import { User } from './entities/user.entity';
import { SupabaseAuthService } from './supabase-auth.service';
import { UserAdminController } from './user-admin.controller';
import { SetUserPasswordDto } from './dto';
import { PUBLIC_KEY, REQUIRED_ROLE_KEY, UNSCOPED_KEY } from './decorators/auth.decorators';
import { verifyPassword } from './user-crypto';

describe('Administrator password changes', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function service(identity: string | null = 'identity-1', exists = true) {
    const users = { findOne: jest.fn().mockResolvedValue(exists ? { id: 'user-1', apiKeyId: 'key-1' } : null), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const keys = { findOne: jest.fn().mockResolvedValue({ supabaseUserId: identity }) };
    const auth = new AuthService(keys as unknown as Repository<ApiKey>, users as unknown as Repository<User>, {} as ApiKeyUsageTracker, {} as never);
    return { auth, users, keys };
  }

  it('retains the unscoped admin gate and returns no password or hash', async () => {
    expect(Reflect.getMetadata(REQUIRED_ROLE_KEY, UserAdminController)).toBe('admin');
    expect(Reflect.getMetadata(UNSCOPED_KEY, UserAdminController)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_KEY, UserAdminController.prototype.setPassword)).toBeUndefined();
    const setUserPassword = jest.fn();
    const logInfo = jest.fn();
    const controller = new UserAdminController({ setUserPassword } as unknown as AuthService, { logInfo } as never);
    expect(await controller.setPassword('user-1', { password: 'new-password' }, { method: 'PATCH', path: '/auth/users/user-1/password' } as never)).toEqual({ success: true });
    expect(setUserPassword).toHaveBeenCalledWith('user-1', 'new-password');
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('new-password');
    expect(logInfo).toHaveBeenCalledWith('user_password_changed', expect.objectContaining({ metadata: { targetUserId: 'user-1' } }));
  });

  it.each(['short', 'a'.repeat(73), undefined, 12345678])('rejects invalid password %s', async password => {
    expect((await validate(Object.assign(new SetUserPasswordDto(), { password }))).length).toBeGreaterThan(0);
  });

  it('updates only the stored hash in local authentication mode', async () => {
    delete process.env.SUPABASE_AUTH_URL;
    const { auth, users } = service();
    await auth.setUserPassword('user-1', 'new-password');
    const hash = users.update.mock.calls[0][1].passwordHash as string;
    expect(hash).not.toContain('new-password');
    expect(verifyPassword('new-password', hash)).toBe(true);
  });

  it('uses the linked Supabase identity and never changes the local password', async () => {
    process.env.SUPABASE_AUTH_URL = 'http://auth:8000';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const { auth, users } = service();
    await auth.setUserPassword('user-1', 'new-password');
    expect(global.fetch).toHaveBeenCalledWith('http://auth:8000/auth/v1/admin/users/identity-1', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ password: 'new-password' }),
      headers: expect.objectContaining({ Authorization: 'Bearer server-only-secret' }),
    }));
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses an unlinked identity rather than resetting a different account', async () => {
    process.env.SUPABASE_AUTH_URL = 'http://auth:8000';
    process.env.SUPABASE_ANON_KEY = 'anon';
    global.fetch = jest.fn();
    await expect(service(null).auth.setUserPassword('user-1', 'new-password')).rejects.toThrow(ConflictException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails for a missing account', async () => {
    await expect(service(null, false).auth.setUserPassword('missing', 'new-password')).rejects.toThrow(NotFoundException);
  });

  it('does not report success when Supabase is unavailable or rejects the password', async () => {
    process.env.SUPABASE_AUTH_URL = 'http://auth:8000';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 422 });
    await expect(new SupabaseAuthService().setUserPassword('identity-1', 'new-password')).rejects.toThrow('password requirements');
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(new SupabaseAuthService().setUserPassword('identity-1', 'new-password')).rejects.toThrow('unavailable');
  });
});

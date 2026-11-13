import { SupabaseAuthController } from './supabase-auth.controller';
import type { AuthService } from './auth.service';
import type { SupabaseAuthService } from './supabase-auth.service';
import { validate } from 'class-validator';
import { UserAdminController } from './user-admin.controller';

describe('customer onboarding', () => {
  it('provisions a verified identity before resolving its Waply operator key', async () => {
    const old = process.env.SUPABASE_SIGNUP_ENABLED;
    process.env.SUPABASE_SIGNUP_ENABLED = 'true';
    try {
      const auth = { ensureVerifiedCustomer: jest.fn(), ensureSupabaseAccount: jest.fn(), findSupabaseKey: jest.fn().mockResolvedValue({ role: 'operator' }) };
      const provider = { enabled: true, signIn: jest.fn().mockResolvedValue({ access_token: 'token', user: {
        id: 'verified-id', email: 'customer@example.test', email_confirmed_at: 'confirmed', user_metadata: { name: 'Customer' }
      } }) };
      const result = await new SupabaseAuthController(provider as unknown as SupabaseAuthService, auth as unknown as AuthService)
        .login({ email: 'customer@example.test', password: 'password' });
      expect(auth.ensureVerifiedCustomer).toHaveBeenCalledWith('verified-id', 'customer@example.test', 'Customer');
      expect(auth.ensureVerifiedCustomer.mock.invocationCallOrder[0]).toBeLessThan(auth.ensureSupabaseAccount.mock.invocationCallOrder[0]);
      expect(auth.ensureSupabaseAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 'verified-id', email: 'customer@example.test' }));
      expect(auth.ensureSupabaseAccount.mock.invocationCallOrder[0]).toBeLessThan(auth.findSupabaseKey.mock.invocationCallOrder[0]);
      expect(result.role).toBe('operator');
    } finally {
      if (old === undefined) delete process.env.SUPABASE_SIGNUP_ENABLED;
      else process.env.SUPABASE_SIGNUP_ENABLED = old;
    }
  });
  it('lets admins select no features or a subset, and rejects unknown or duplicate features', async () => {
    const dto = Reflect.getMetadata('design:paramtypes', UserAdminController.prototype, 'update')[1];
    for (const features of [[], ['leads', 'templates']]) expect(await validate(Object.assign(new dto(), { features }))).toHaveLength(0);
    for (const features of [['admin'], ['leads', 'leads'], null]) expect((await validate(Object.assign(new dto(), { features }))).length).toBeGreaterThan(0);
  });
});

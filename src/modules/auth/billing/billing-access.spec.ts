import { SubscriptionAccessService } from './subscription-access.service';
import { SendPacingService } from '../../message/send-pacing.service';
import { DataSource } from 'typeorm';
import { ModuleRef, Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';
import { ApiKey } from '../entities/api-key.entity';
import { BillingRecord } from '../entities/billing-record.entity';
import { BillingService } from './billing.service';
import { AuthService } from '../auth.service';
import { ApiKeyUsageTracker } from '../api-key-usage-tracker.service';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { AuditService } from '../../audit/audit.service';
import { BillingRecovery } from '../decorators/auth.decorators';
import { BillingExpiryService } from './billing-expiry.service';

class Routes {
  ordinary(this: void) {}
  @BillingRecovery() recovery(this: void) {}
}
describe('subscription access and signup', () => {
  let db: DataSource;
  let auth: AuthService;
  let billing: BillingService;
  const env = { ...process.env };
  beforeEach(async () => {
    delete process.env.SUPABASE_AUTH_URL;
    delete process.env.SUPABASE_ANON_KEY;
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [User, ApiKey, BillingRecord],
      synchronize: true,
    });
    await db.initialize();
    billing = new BillingService(db.getRepository(BillingRecord));
    await billing.saveSettings({ trialDays: 10, trialMaxSessions: 3, plans: [] });
    auth = new AuthService(
      db.getRepository(ApiKey),
      db.getRepository(User),
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as ApiKeyUsageTracker,
      { get: () => billing } as unknown as ModuleRef,
    );
  });
  afterEach(async () => {
    await db.destroy();
    process.env = { ...env };
  });
  async function signup() {
    return auth.register({ email: 'test@example.com', name: 'Test', password: 'securepassword' });
  }
  async function guard(token: string, recovery = false) {
    const route = recovery ? Routes.prototype.recovery : Routes.prototype.ordinary;
    const context = {
      getHandler: () => route,
      getClass: () => Routes,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          params: {},
          method: 'GET',
          path: '/test',
          socket: { remoteAddress: '127.0.0.1' },
        }),
      }),
    } as unknown as ExecutionContext;
    return new ApiKeyGuard(auth, new Reflector(), new ConfigService(), {
      logWarn: jest.fn(),
    } as unknown as AuditService).canActivate(context);
  }
  it('creates a customer and key with the administrator configured finite trial', async () => {
    const session = await signup();
    const user = await auth.getUserProfile(session.user.id);
    expect(user.maxSessions).toBe(3);
    expect(user.subscriptionStatus).toBe('trial');
    expect(user.apiKeyId).toBeTruthy();
    expect(user.subscriptionExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 86400000);
    await expect(guard(session.token)).resolves.toBe(true);
  });
  it('blocks an expired customer but allows billing recovery with the same credential', async () => {
    const session = await signup();
    await db.getRepository(User).update(session.user.id, { subscriptionExpiresAt: new Date(Date.now() - 1000) });
    await expect(guard(session.token)).rejects.toThrow('trial or subscription has ended');
    await expect(guard(session.token, true)).resolves.toBe(true);
  });
  it('rejects disabled accounts even on recovery routes', async () => {
    const session = await signup();
    await db.getRepository(User).update(session.user.id, { isActive: false });
    await expect(guard(session.token, true)).rejects.toThrow();
  });
  it('provisions a verified Supabase signup once without granting a second trial on login', async () => {
    process.env.SUPABASE_SIGNUP_ENABLED = 'true';
    const identity = {
      id: 'supabase-test',
      email: 'verified@example.com',
      email_confirmed_at: new Date().toISOString(),
    };
    await auth.ensureSupabaseAccount(identity);
    await auth.ensureSupabaseAccount(identity);
    expect(await db.getRepository(User).count()).toBe(1);
    expect((await db.getRepository(User).findOneByOrFail({ email: identity.email })).maxSessions).toBe(3);
    await expect(auth.ensureSupabaseAccount({ id: 'unverified', email: 'unverified@example.com' })).rejects.toThrow();
  });
  it('rolls back the provisioned key if customer creation fails', async () => {
    db.subscribers.push({
      listenTo: () => User,
      beforeInsert: () => {
        throw new Error('Customer save failed');
      },
    });
    await expect(signup()).rejects.toThrow('Customer save failed');
    expect(await db.getRepository(ApiKey).count()).toBe(0);
    expect(await db.getRepository(User).count()).toBe(0);
  });
  it('blocks internal automation sends after expiry even when pacing is disabled', async () => {
    const session = await signup();
    const user = await auth.getUserProfile(session.user.id);
    await db.getRepository(ApiKey).update(user.apiKeyId!, { allowedSessions: ['session-1'] });
    const access = new SubscriptionAccessService(db.getRepository(User), db.getRepository(ApiKey));
    const pacing = new SendPacingService(
      {} as never,
      {} as never,
      new ConfigService({ sendPacing: { enabled: false } }),
      undefined,
      access,
    );
    await expect(access.assertSessionAccess('session-1')).resolves.toBeUndefined();
    await db.getRepository(User).update(user.id, { subscriptionExpiresAt: new Date(Date.now() - 1000) });
    await expect(access.assertSessionAccess('session-1')).rejects.toThrow('trial or subscription');
    await expect(pacing.assertSendAllowed('session-1')).rejects.toThrow('trial or subscription');
    await expect(pacing.assertReachoutAllowed('session-1', ['contact'])).rejects.toThrow('trial or subscription');
    await expect(access.assertSessionAccess('unrelated-session')).resolves.toBeUndefined();
  });
  it('pauses an expired customer engine while retaining active accounts', async () => {
    const session = await signup();
    const user = await auth.getUserProfile(session.user.id);
    await db.getRepository(ApiKey).update(user.apiKeyId!, { allowedSessions: ['session-1'] });
    const sessions = { getEngine: jest.fn().mockReturnValue({}), stop: jest.fn().mockResolvedValue({}) };
    const expiry = new BillingExpiryService(db.getRepository(User), { get: () => sessions } as unknown as ModuleRef);
    await expiry.sweep();
    expect(sessions.stop).not.toHaveBeenCalled();
    await db.getRepository(User).update(user.id, { subscriptionExpiresAt: new Date(Date.now() - 1000) });
    await expiry.sweep();
    expect(sessions.stop).toHaveBeenCalledWith('session-1');
  });
});

import { DataSource } from 'typeorm';
import { ModuleRef } from '@nestjs/core';
import { AuthService } from './auth.service';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { User, UserRole, SubscriptionPlan, SubscriptionStatus } from './entities/user.entity';
import { BillingRecord } from './entities/billing-record.entity';
import { BillingService } from './billing/billing.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { hashPassword, verifyToken } from './user-crypto';
import { UserAdminController } from './user-admin.controller';
import { UserAuthController } from './user-auth.controller';

describe('customer account lifecycle and provisioning rollback', () => {
  let db: DataSource;
  let auth: AuthService;
  const previous = { ...process.env };
  const dto = { email: '  Customer@Example.Test ', name: ' Customer ', password: 'correct-long-password' };
  beforeEach(async () => {
    delete process.env.SUPABASE_AUTH_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.JWT_SECRET = 'private-local-test-secret-with-enough-length';
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [ApiKey, User, BillingRecord],
      synchronize: true,
    });
    await db.initialize();
    const billing = new BillingService(db.getRepository(BillingRecord));
    await billing.saveSettings({ trialDays: 5, trialMaxSessions: 2, plans: [] });
    auth = new AuthService(
      db.getRepository(ApiKey),
      db.getRepository(User),
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as ApiKeyUsageTracker,
      { get: () => billing } as unknown as ModuleRef,
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.destroy();
    process.env = { ...previous };
  });
  const enableSupabase = () => {
    process.env.SUPABASE_AUTH_URL = 'https://auth.example.test';
    process.env.SUPABASE_ANON_KEY = 'fixture';
  };

  it('normalizes new identities, rejects duplicate email and reuses the original gateway key on login', async () => {
    const created = await auth.register(dto);
    expect(created.user).toMatchObject({
      email: 'customer@example.test',
      name: 'Customer',
      role: 'user',
      maxSessions: 2,
    });
    expect(verifyToken(created.token)?.apiKeyId).toBeTruthy();
    await expect(auth.register({ ...dto, email: 'customer@example.test' })).rejects.toThrow('already exists');
    const loggedIn = await auth.userLogin({ email: dto.email, password: dto.password });
    expect(loggedIn.user.apiKey).toBe('');
    expect(verifyToken(loggedIn.token)?.apiKeyId).toBe(verifyToken(created.token)?.apiKeyId);
    await expect(auth.validateApiKey(loggedIn.token)).resolves.toMatchObject({ role: ApiKeyRole.OPERATOR });
    expect(await db.getRepository(ApiKey).count()).toBe(1);
  });
  it('rejects missing, disabled and wrong-password accounts with the same public error', async () => {
    await expect(auth.userLogin({ email: dto.email, password: dto.password })).rejects.toThrow(
      'Invalid email or password',
    );
    const created = await auth.register(dto);
    await expect(auth.userLogin({ email: dto.email, password: 'wrong' })).rejects.toThrow('Invalid email or password');
    await db.getRepository(User).update(created.user.id, { isActive: false });
    await expect(auth.userLogin({ email: dto.email, password: dto.password })).rejects.toThrow(
      'Invalid email or password',
    );
  });
  it.each([UserRole.USER, UserRole.ADMIN])('repairs a missing gateway key with the correct role for %s', async role => {
    const user = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: 'repair@example.test',
        name: 'Repair',
        passwordHash: hashPassword(dto.password),
        role,
        apiKeyId: null,
      }),
    );
    const login = await auth.userLogin({ email: user.email, password: dto.password });
    expect(login.user.apiKey).toMatch(/^owa_user_/);
    const key = await auth.validateApiKey(login.user.apiKey);
    expect(key.role).toBe(role === UserRole.ADMIN ? ApiKeyRole.ADMIN : ApiKeyRole.OPERATOR);
    expect((await auth.getUserProfile(user.id)).apiKeyId).toBe(key.id);
  });
  it('keeps administrative projections free of password hashes and persists a complete subscription patch', async () => {
    const admin = new UserAdminController(auth);
    const created = await admin.create(dto);
    expect(created).not.toHaveProperty('passwordHash');
    const updated = await admin.update(created.id, {
      plan: SubscriptionPlan.PRO,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      maxSessions: 5,
      subscriptionExpiresAt: '2030-01-01T00:00:00Z',
    });
    expect(updated).toMatchObject({ plan: SubscriptionPlan.PRO, maxSessions: 5, subscriptionStatus: 'active' });
    expect(updated.subscriptionExpiresAt).toEqual(new Date('2030-01-01T00:00:00Z'));
    expect(updated).not.toHaveProperty('passwordHash');
    expect(await admin.list()).toHaveLength(1);
    expect((await admin.list())[0]).not.toHaveProperty('passwordHash');
    await auth.updateSubscription(created.id, {});
    expect(
      (await auth.updateSubscription(created.id, { subscriptionExpiresAt: null })).subscriptionExpiresAt,
    ).toBeNull();
    await expect(auth.getUserProfile('missing')).rejects.toThrow('User not found');
  });
  it('returns the safe customer profile, a key-only profile, or null for an absent actor', async () => {
    const created = await auth.register(dto);
    const key = await auth.validateApiKey(created.user.apiKey);
    const controller = new UserAuthController(auth);
    const profile = await controller.getProfile(key);
    expect(profile?.user).toMatchObject({ id: created.user.id, email: 'customer@example.test' });
    expect(JSON.stringify(profile)).not.toContain('passwordHash');
    expect(await controller.getProfile()).toBeNull();
    expect((await controller.getProfile({ ...key, id: 'unowned' }))?.user).toBeNull();
    expect((await controller.login({ email: dto.email, password: dto.password })).user.id).toBe(created.user.id);
  });
  it('assigns each customer session once and rejects missing or revoked keys', async () => {
    const created = await auth.register(dto);
    const key = await auth.validateApiKey(created.user.apiKey);
    await auth.assignUserSession(key.id, 'first');
    await auth.assignUserSession(key.id, 'first');
    await auth.assignUserSession(key.id, 'second');
    expect((await auth.findOne(key.id)).allowedSessions).toEqual(['first', 'second']);
    await expect(auth.assignUserSession('missing', 'other')).rejects.toThrow('Account API key not found');
    await db.getRepository(ApiKey).update(key.id, { isActive: false });
    await expect(auth.assignUserSession(key.id, 'other')).rejects.toThrow('Account API key not found');
  });
  it('disables both local signup and local password login in Supabase mode', async () => {
    enableSupabase();
    await expect(auth.register(dto)).rejects.toThrow('Supabase email signup');
    await expect(auth.userLogin({ email: dto.email, password: dto.password })).rejects.toThrow('Supabase email login');
  });
  it('creates confirmed provider identities with a finite local trial and no usable local password', async () => {
    enableSupabase();
    const provider = jest.spyOn(SupabaseAuthService.prototype, 'createUser').mockResolvedValue({ id: 'provider-user' });
    const user = await auth.createAdminUser(dto);
    expect(provider).toHaveBeenCalledWith('customer@example.test', dto.password, 'Customer');
    expect(user).toMatchObject({
      email: 'customer@example.test',
      name: 'Customer',
      maxSessions: 2,
      subscriptionStatus: 'trial',
    });
    expect(user.subscriptionExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 86400000);
    expect((await auth.findSupabaseKey('provider-user')).id).toBe(user.apiKeyId);
    await expect(auth.createAdminUser(dto)).rejects.toThrow('already exists');
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    'rolls back provider provisioning after a local failure (rollback also fails: %s)',
    async rollbackFails => {
      enableSupabase();
      jest.spyOn(SupabaseAuthService.prototype, 'createUser').mockResolvedValue({ id: 'new-provider-user' });
      const rollback = jest.spyOn(SupabaseAuthService.prototype, 'deleteCreatedUser');
      if (rollbackFails) rollback.mockRejectedValue(new Error('provider unavailable'));
      else rollback.mockResolvedValue();
      db.subscribers.push({
        listenTo: () => User,
        beforeInsert: () => {
          throw new Error('local insert failed');
        },
      });
      await expect(auth.createAdminUser(dto)).rejects.toThrow('local insert failed');
      expect(rollback).toHaveBeenCalledWith('new-provider-user');
      expect(await db.getRepository(ApiKey).count()).toBe(0);
      expect(await db.getRepository(User).count()).toBe(0);
    },
  );
  it('never links an unverified or disabled-signup identity automatically', async () => {
    const identity = { id: 'identity', email: dto.email, email_confirmed_at: '2026-01-01' };
    delete process.env.SUPABASE_SIGNUP_ENABLED;
    await expect(auth.ensureSupabaseAccount(identity)).rejects.toThrow('not linked');
    process.env.SUPABASE_SIGNUP_ENABLED = 'true';
    await expect(auth.ensureSupabaseAccount({ id: 'identity', email_confirmed_at: 'verified' })).rejects.toThrow(
      'not linked',
    );
    await expect(auth.ensureSupabaseAccount({ id: 'identity', email: dto.email })).rejects.toThrow('not linked');
    expect(await db.getRepository(ApiKey).count()).toBe(0);
  });
  it('preserves existing email ownership and rolls back a conflicting auto-provisioned key', async () => {
    await auth.register(dto);
    process.env.SUPABASE_SIGNUP_ENABLED = 'true';
    await expect(
      auth.ensureSupabaseAccount({ id: 'new-identity', email: dto.email, email_confirmed_at: 'verified' }),
    ).rejects.toThrow('already has an account');
    expect(await db.getRepository(ApiKey).count()).toBe(1);
    expect(await db.getRepository(User).count()).toBe(1);
  });
  it('preserves unrelated database failures during verified provisioning', async () => {
    process.env.SUPABASE_SIGNUP_ENABLED = 'true';
    db.subscribers.push({
      listenTo: () => User,
      beforeInsert: () => {
        throw new Error('database offline');
      },
    });
    await expect(
      auth.ensureSupabaseAccount({ id: 'new-identity', email: dto.email, email_confirmed_at: 'verified' }),
    ).rejects.toThrow('database offline');
    expect(await db.getRepository(ApiKey).count()).toBe(0);
  });
});

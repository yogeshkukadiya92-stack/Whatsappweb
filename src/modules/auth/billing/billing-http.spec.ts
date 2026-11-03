import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector, ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHmac } from 'crypto';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingRecord } from '../entities/billing-record.entity';
import { User, SubscriptionStatus } from '../entities/user.entity';
import { ApiKey, ApiKeyRole } from '../entities/api-key.entity';
import { AuthService } from '../auth.service';
import { ApiKeyUsageTracker } from '../api-key-usage-tracker.service';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { AuditService } from '../../audit/audit.service';
import { SupabaseAuthController } from '../supabase-auth.controller';
import { SupabaseAuthService } from '../supabase-auth.service';
import { UserAuthController } from '../user-auth.controller';
import { UserAdminController } from '../user-admin.controller';
import { applyGlobalValidation } from '../../../config/app-validation';

describe('billing HTTP authentication and recovery contract', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let auth: AuthService;
  let billing: BillingService;
  let admin: string;
  let customer: string;
  let customerId: string;
  const saved = { ...process.env };
  const originalFetch = global.fetch;
  const hmac = (value: string, key: string) => createHmac('sha256', key).update(value).digest('hex');
  const settings = {
    trialDays: 3,
    trialMaxSessions: 1,
    plans: [{ id: 'monthly', name: 'Monthly', months: 1, amount: 299, maxSessions: 1 }],
  };
  beforeAll(async () => {
    delete process.env.SUPABASE_AUTH_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.DASHBOARD_SIGNUP_ENABLED = 'true';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
    process.env.RAZORPAY_KEY_SECRET = 'test-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [User, ApiKey, BillingRecord],
      synchronize: true,
    });
    await db.initialize();
    billing = new BillingService(db.getRepository(BillingRecord));
    await billing.saveSettings(settings);
    auth = new AuthService(
      db.getRepository(ApiKey),
      db.getRepository(User),
      {
        record: jest.fn().mockResolvedValue(undefined),
        flushOnShutdown: jest.fn().mockResolvedValue(undefined),
      } as unknown as ApiKeyUsageTracker,
      { get: () => billing } as unknown as ModuleRef,
    );
    admin = (await auth.createApiKey({ name: 'Admin', role: ApiKeyRole.ADMIN })).rawKey;
    const signup = await auth.register({
      email: 'customer@example.test',
      name: 'Customer',
      password: 'fixture-password',
    });
    customer = signup.user.apiKey;
    customerId = signup.user.id;
    const testing = await Test.createTestingModule({
      controllers: [BillingController, UserAuthController, UserAdminController, SupabaseAuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: BillingService, useValue: billing },
        SupabaseAuthService,
      ],
    }).compile();
    app = testing.createNestApplication<INestApplication<App>>({ rawBody: true });
    applyGlobalValidation(app);
    app.useGlobalGuards(
      new ApiKeyGuard(auth, new Reflector(), new ConfigService(), {
        logWarn: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditService),
    );
    await app.init();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    await app.close();
    await db.destroy();
    process.env = { ...saved };
  });
  it('enforces admin role, unscoped credentials and DTO validation before changing prices', async () => {
    await request(app.getHttpServer()).get('/api/billing/settings').expect(401);
    await request(app.getHttpServer())
      .put('/api/billing/settings')
      .set('X-API-Key', customer)
      .send(settings)
      .expect(403);
    const scoped = (
      await auth.createApiKey({ name: 'Scoped administrator', role: ApiKeyRole.ADMIN, allowedSessions: ['one'] })
    ).rawKey;
    await request(app.getHttpServer()).put('/api/billing/settings').set('X-API-Key', scoped).send(settings).expect(403);
    await request(app.getHttpServer())
      .put('/api/billing/settings')
      .set('X-API-Key', admin)
      .send({ ...settings, plans: [settings.plans[0], settings.plans[0]] })
      .expect(400);
    await request(app.getHttpServer()).put('/api/billing/settings').set('X-API-Key', admin).send(settings).expect(200);
    const published = await request(app.getHttpServer())
      .get('/api/billing/settings')
      .set('X-API-Key', admin)
      .expect(200);
    expect(published.body).toEqual(settings);
    expect(
      (await request(app.getHttpServer()).get('/api/billing/status').set('X-API-Key', admin).expect(200)).body,
    ).toMatchObject({ access: true, account: null });
    await request(app.getHttpServer())
      .post('/api/billing/checkout')
      .set('X-API-Key', admin)
      .send({ planId: 'monthly' })
      .expect(400);
  });
  it('reports missing entitlement, inactive accounts and paid recovery without a second grant', async () => {
    for (const patch of [
      { subscriptionExpiresAt: null },
      { subscriptionExpiresAt: new Date(Date.now() - 1000) },
      { subscriptionStatus: SubscriptionStatus.CANCELLED },
    ]) {
      await db.getRepository(User).update(customerId, patch);
      expect(
        (await request(app.getHttpServer()).get('/api/billing/status').set('X-API-Key', customer).expect(200)).body,
      ).toMatchObject({ access: false, account: { status: 'expired' } });
    }
    await db.getRepository(User).update(customerId, { isActive: false });
    await request(app.getHttpServer()).get('/api/billing/status').set('X-API-Key', customer).expect(403);
    await db.getRepository(User).update(customerId, { isActive: true, subscriptionStatus: SubscriptionStatus.EXPIRED });
    global.fetch = jest.fn((_input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? { id: 'order_fixture' }
              : { id: 'pay_fixture', order_id: 'order_fixture', amount: 29900, currency: 'INR', status: 'captured' },
          ),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;
    await request(app.getHttpServer())
      .post('/api/billing/checkout')
      .set('X-API-Key', customer)
      .send({ planId: 'monthly' })
      .expect(201);
    const verify = {
      orderId: 'order_fixture',
      paymentId: 'pay_fixture',
      signature: hmac('order_fixture|pay_fixture', 'test-secret'),
    };
    await request(app.getHttpServer())
      .post('/api/billing/verify')
      .set('X-API-Key', customer)
      .send({ ...verify, signature: '0'.repeat(64) })
      .expect(401);
    await request(app.getHttpServer()).post('/api/billing/verify').set('X-API-Key', customer).send(verify).expect(201);
    const expiry = (await auth.getUserProfile(customerId)).subscriptionExpiresAt;
    await request(app.getHttpServer()).post('/api/billing/verify').set('X-API-Key', customer).send(verify).expect(201);
    expect((await auth.getUserProfile(customerId)).subscriptionExpiresAt).toEqual(expiry);
    expect(
      (await request(app.getHttpServer()).get('/api/billing/status').set('X-API-Key', customer).expect(200)).body,
    ).toMatchObject({ access: true, account: { status: 'active' } });
  });
  it('accepts only a raw-body provider signature and validates captured event identity', async () => {
    const send = (body: unknown, signingKey = 'webhook-secret') => {
      const raw = JSON.stringify(body);
      return request(app.getHttpServer())
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', hmac(raw, signingKey))
        .send(raw);
    };
    await send({}, 'wrong-secret').expect(401);
    await request(app.getHttpServer()).post('/api/billing/webhook').send({}).expect(401);
    await send({ event: 'payment.failed' }).expect(200, { received: true });
    await send({ event: 'payment.captured' }).expect(400);
    await send({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 12, id: 'pay_fixture' } } },
    }).expect(400);
    await send({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'order_fixture', id: 'pay_fixture' } } },
    }).expect(200);
  });
  it('keeps provider signup disabled until configured and derives roles from the linked local account', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/supabase/login')
      .send({ email: 'new@example.test', password: 'fixture-password' })
      .expect(503);
    process.env.SUPABASE_AUTH_URL = 'https://auth.example.test';
    process.env.SUPABASE_ANON_KEY = 'public-fixture';
    delete process.env.SUPABASE_SIGNUP_ENABLED;
    await request(app.getHttpServer())
      .post('/api/auth/supabase/signup')
      .send({ email: 'new@example.test', name: 'New', password: 'fixture-password' })
      .expect(503);
    expect((await request(app.getHttpServer()).get('/api/auth/supabase/status').expect(200)).body).toEqual({
      enabled: true,
      signupEnabled: false,
    });
    process.env.SUPABASE_SIGNUP_ENABLED = 'true';
    const providerUser = { id: 'provider-new', email: 'new@example.test', email_confirmed_at: '2026-01-01' };
    const providerSession = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: providerUser };
    jest.spyOn(SupabaseAuthService.prototype, 'signUp').mockResolvedValue();
    jest.spyOn(SupabaseAuthService.prototype, 'signIn').mockResolvedValue(providerSession);
    jest.spyOn(SupabaseAuthService.prototype, 'refresh').mockResolvedValue(providerSession);
    await request(app.getHttpServer())
      .post('/api/auth/supabase/signup')
      .send({ email: providerUser.email, name: 'New', password: 'fixture-password' })
      .expect(202);
    const login = await request(app.getHttpServer())
      .post('/api/auth/supabase/login')
      .send({ email: providerUser.email, password: 'fixture-password' })
      .expect(200);
    expect(login.body).toMatchObject({
      token: 'access',
      refreshToken: 'refresh',
      role: 'operator',
      allowedSessions: null,
    });
    await request(app.getHttpServer()).post('/api/auth/supabase/refresh').send({ refreshToken: 'refresh' }).expect(200);
    const linked = await auth.findSupabaseKey(providerUser.id);
    expect(await db.getRepository(User).countBy({ apiKeyId: linked.id })).toBe(1);
    jest
      .spyOn(SupabaseAuthService.prototype, 'signIn')
      .mockResolvedValue({ ...providerSession, user: { ...providerUser, id: 'provider-existing' } });
    await request(app.getHttpServer())
      .post('/api/auth/supabase/link')
      .set('X-API-Key', customer)
      .send({ email: 'customer@example.test', password: 'fixture-password' })
      .expect(200);
    expect((await auth.findSupabaseKey('provider-existing')).id).toBe((await auth.validateApiKey(customer)).id);
  });
});

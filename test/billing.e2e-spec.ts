import { SessionService } from '../src/modules/session/session.service';
import { ApiKey } from '../src/modules/auth/entities/api-key.entity';
jest.mock('archiver', () => ({ TarArchive: jest.fn() }));

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { applyGlobalValidation } from '../src/config/app-validation';
import { AuthService } from '../src/modules/auth/auth.service';
import { ApiKeyRole } from '../src/modules/auth/entities/api-key.entity';
import { User } from '../src/modules/auth/entities/user.entity';

// Real HTTP, validation, authentication and persistence; only the external payment provider is faked.
describe('signup, trial, billing and captured payment (e2e)', () => {
  let app: INestApplication<App>;
  let admin: string;
  let customer: string;
  let customerId: string;
  let users: Repository<User>;
  let orderSequence = 0;
  let captureStatus = 'captured';
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const settings = {
    trialDays: 5,
    trialMaxSessions: 2,
    plans: [{ id: 'quarterly', name: 'Quarterly', months: 3, amount: 999, maxSessions: 4 }],
  };
  beforeAll(async () => {
    delete process.env.SUPABASE_AUTH_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.DASHBOARD_SIGNUP_ENABLED = 'true';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_e2e';
    process.env.RAZORPAY_KEY_SECRET = 'e2e-secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'e2e-webhook-secret';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true });
    applyGlobalValidation(app);
    await app.init();
    users = app.get(getRepositoryToken(User, 'main'));
    admin = (await app.get(AuthService).createApiKey({ name: 'Billing admin', role: ApiKeyRole.ADMIN })).rawKey;
    global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://api.razorpay.com/v1/')) return originalFetch(input, init);
      if (init?.method === 'POST') {
        orderSequence += 1;
        return Promise.resolve(new Response(JSON.stringify({ id: `order_e2e${orderSequence}` }), { status: 200 }));
      }
      const paymentId = url.split('/').at(-1)!;
      const suffix = paymentId.replace('pay_e2e', '');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: paymentId,
            order_id: `order_e2e${suffix}`,
            amount: 99900,
            currency: 'INR',
            status: captureStatus,
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;
  });
  afterAll(async () => {
    global.fetch = originalFetch;
    await app?.close();
    process.env = { ...originalEnv };
  });

  it('lets the administrator configure plans and rejects invalid or customer changes', async () => {
    await request(app.getHttpServer())
      .put('/api/billing/settings')
      .set('X-API-Key', admin)
      .send({ ...settings, trialDays: -1 })
      .expect(400);
    await request(app.getHttpServer()).put('/api/billing/settings').set('X-API-Key', admin).send(settings).expect(200);
    const signup = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'billing@example.com', password: 'securePassword123', name: 'Billing customer' })
      .expect(201);
    const signedUp = signup.body as { token: string; user: { id: string } };
    customer = signedUp.token;
    customerId = signedUp.user.id;
    expect((await users.findOneByOrFail({ id: customerId })).maxSessions).toBe(2);
    const status = await request(app.getHttpServer())
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    expect((status.body as { access: boolean }).access).toBe(true);
    expect((status.body as { account: { status: string } }).account.status).toBe('trial');
    await request(app.getHttpServer())
      .put('/api/billing/settings')
      .set('Authorization', `Bearer ${customer}`)
      .send(settings)
      .expect(403);
  });
  it('blocks expired feature access but permits the profile and checkout recovery routes', async () => {
    await users.update(customerId, { subscriptionExpiresAt: new Date(Date.now() - 1000) });
    const owner = await users.findOneByOrFail({ id: customerId });
    await app
      .get<Repository<ApiKey>>(getRepositoryToken(ApiKey, 'main'))
      .update(owner.apiKeyId!, { allowedSessions: ['expired-start'] });
    await expect(app.get(SessionService).start('expired-start')).rejects.toThrow('trial or subscription');
    await request(app.getHttpServer()).get('/api/sessions').set('Authorization', `Bearer ${customer}`).expect(403);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${customer}`).expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    expect((response.body as { access: boolean }).access).toBe(false);
  });
  it('requires the exact signature and a captured payment, and grants the purchased term once', async () => {
    const checkout = await request(app.getHttpServer())
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${customer}`)
      .send({ planId: 'quarterly' })
      .expect(201);
    const order = checkout.body as { amount: number; keyId: string; orderId: string };
    expect(order.amount).toBe(99900);
    expect(order.keyId).toBe('rzp_test_e2e');
    const orderId = order.orderId;
    const paymentId = orderId.replace('order_', 'pay_');
    const signature = createHmac('sha256', 'e2e-secret').update(`${orderId}|${paymentId}`).digest('hex');
    await request(app.getHttpServer())
      .post('/api/billing/verify')
      .set('Authorization', `Bearer ${customer}`)
      .send({ orderId, paymentId, signature: '0'.repeat(64) })
      .expect(401);
    captureStatus = 'authorized';
    await request(app.getHttpServer())
      .post('/api/billing/verify')
      .set('Authorization', `Bearer ${customer}`)
      .send({ orderId, paymentId, signature })
      .expect(400);
    captureStatus = 'captured';
    await request(app.getHttpServer())
      .post('/api/billing/verify')
      .set('Authorization', `Bearer ${customer}`)
      .send({ orderId, paymentId, signature })
      .expect(201);
    const account = await users.findOneByOrFail({ id: customerId });
    expect(account.subscriptionStatus).toBe('active');
    expect(account.maxSessions).toBe(4);
    const raw = JSON.stringify(
      { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId } } } },
      null,
      2,
    );
    const webhookSignature = createHmac('sha256', 'e2e-webhook-secret').update(raw).digest('hex');
    await request(app.getHttpServer())
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', '0'.repeat(64))
      .send(raw)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', webhookSignature)
      .send(raw)
      .expect(200);
    expect((await users.findOneByOrFail({ id: customerId })).subscriptionExpiresAt).toEqual(
      account.subscriptionExpiresAt,
    );
    await request(app.getHttpServer()).get('/api/sessions').set('Authorization', `Bearer ${customer}`).expect(200);
  });
  it('activates from the signed webhook even when the browser never returns, and ignores unrelated orders', async () => {
    const checkout = await request(app.getHttpServer())
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${customer}`)
      .send({ planId: 'quarterly' })
      .expect(201);
    const { orderId } = checkout.body as { orderId: string };
    const before = (await users.findOneByOrFail({ id: customerId })).subscriptionExpiresAt!;
    const deliver = async (id: string) => {
      const raw = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { order_id: id, id: id.replace('order_', 'pay_') } } },
      });
      const signature = createHmac('sha256', 'e2e-webhook-secret').update(raw).digest('hex');
      await request(app.getHttpServer())
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signature)
        .send(raw)
        .expect(200);
    };
    await deliver(orderId);
    const after = (await users.findOneByOrFail({ id: customerId })).subscriptionExpiresAt!;
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime() + 89 * 86400000);
    await deliver('order_otherproduct');
    expect((await users.findOneByOrFail({ id: customerId })).subscriptionExpiresAt).toEqual(after);
  });
});

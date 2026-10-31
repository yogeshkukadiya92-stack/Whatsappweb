/* eslint-disable @typescript-eslint/require-await */
import { DataSource, Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { BillingService, addMonths, verifySignature } from './billing.service';
import { BillingRecord } from '../entities/billing-record.entity';
import { User, UserRole, SubscriptionStatus } from '../entities/user.entity';

// Exercise real persistence, payment verification and replay handling without external charges.
describe('Razorpay billing', () => {
  let db: DataSource;
  let service: BillingService;
  let users: Repository<User>;
  let user: User;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  beforeEach(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_example';
    process.env.RAZORPAY_KEY_SECRET = 'secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook';
    db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [User, BillingRecord],
      synchronize: true,
    });
    await db.initialize();
    service = new BillingService(db.getRepository(BillingRecord));
    users = db.getRepository(User);
    user = await users.save(
      users.create({
        email: 'client@example.com',
        passwordHash: 'unused',
        name: 'Client',
        role: UserRole.USER,
        subscriptionStatus: SubscriptionStatus.TRIAL,
      }),
    );
    await service.saveSettings({
      trialDays: 5,
      trialMaxSessions: 2,
      plans: [{ id: 'quarterly', name: 'Quarterly', months: 3, amount: 999, maxSessions: 4 }],
    });
    global.fetch = jest.fn(
      async (_url, init) =>
        ({
          ok: true,
          json: async () =>
            init?.method === 'POST'
              ? { id: 'order_test' }
              : { id: 'pay_test', order_id: 'order_test', status: 'captured', amount: 99900, currency: 'INR' },
        }) as Response,
    );
  });
  afterEach(async () => {
    await db.destroy();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });
  it('uses configured trial settings and gives the account a finite expiry', async () => {
    const trial = await service.trial();
    expect(trial.maxSessions).toBe(2);
    expect(trial.subscriptionExpiresAt.getTime() - Date.now()).toBeCloseTo(5 * 86400000, -3);
  });
  it('snapshots price and term, then activates only once across callback/webhook retries', async () => {
    const order = await service.checkout(user, 'quarterly');
    expect(order.amount).toBe(99900);
    await service.saveSettings({ trialDays: 3, trialMaxSessions: 1, plans: [] });
    await service.confirm(order.orderId, 'pay_test', user.id);
    const first = await users.findOneByOrFail({ id: user.id });
    expect(first.subscriptionStatus).toBe('active');
    expect(first.maxSessions).toBe(4);
    expect(first.subscriptionExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86400000);
    await service.confirm(order.orderId, 'pay_test');
    expect((await users.findOneByOrFail({ id: user.id })).subscriptionExpiresAt).toEqual(first.subscriptionExpiresAt);
  });
  it.each([{ status: 'authorized' }, { amount: 1 }, { currency: 'USD' }, { order_id: 'order_wrong' }])(
    'rejects a payment with mismatched entitlement evidence: %j',
    async mismatch => {
      await service.checkout(user, 'quarterly');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'captured',
          amount: 99900,
          currency: 'INR',
          order_id: 'order_test',
          ...mismatch,
        }),
      });
      await expect(service.confirm('order_test', 'pay_test', user.id)).rejects.toThrow('Payment is not captured');
      expect((await users.findOneByOrFail({ id: user.id })).subscriptionStatus).toBe('trial');
    },
  );
  it('rejects a customer verifying another account order', async () => {
    await service.checkout(user, 'quarterly');
    await expect(service.confirm('order_test', 'pay_test', 'other')).rejects.toThrow('another account');
  });
  it('serializes simultaneous callback and webhook fulfillment on SQLite', async () => {
    await service.checkout(user, 'quarterly');
    await Promise.all([service.confirm('order_test', 'pay_test', user.id), service.confirm('order_test', 'pay_test')]);
    const account = await users.findOneByOrFail({ id: user.id });
    expect(account.subscriptionExpiresAt!.getTime()).toBeLessThan(Date.now() + 94 * 86400000);
    expect(account.subscriptionExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86400000);
  });
  it('preserves remaining paid time on renewal', async () => {
    user.subscriptionStatus = SubscriptionStatus.ACTIVE;
    user.subscriptionExpiresAt = new Date('2030-01-31T12:30:00Z');
    await users.save(user);
    await service.checkout(user, 'quarterly');
    await service.confirm('order_test', 'pay_test');
    expect((await users.findOneByOrFail({ id: user.id })).subscriptionExpiresAt!.toISOString()).toBe(
      '2030-04-30T12:30:00.000Z',
    );
  });
  it('clamps calendar months including leap years', () => {
    expect(addMonths(new Date('2028-01-31T01:02:03Z'), 1).toISOString()).toBe('2028-02-29T01:02:03.000Z');
  });
  it('verifies exact signed bytes and rejects tampering', () => {
    const body = Buffer.from('{ "event": "payment.captured" }');
    const signature = createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifySignature(body, signature, 'secret')).toBe(true);
    expect(verifySignature(Buffer.from('{}'), signature, 'secret')).toBe(false);
    expect(verifySignature(body, 'invalid', 'secret')).toBe(false);
    expect(verifySignature(body, signature, '')).toBe(false);
  });
});

import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { BillingRecord } from '../entities/billing-record.entity';
import { User, SubscriptionStatus, SubscriptionPlan } from '../entities/user.entity';

export interface BillingPlan {
  id: string;
  name: string;
  months: number;
  amount: number;
  maxSessions: number;
}
export interface BillingSettings {
  trialDays: number;
  trialMaxSessions: number;
  plans: BillingPlan[];
}
interface Order {
  userId: string;
  plan: BillingPlan;
  amount: number;
  fulfilled?: boolean;
  paymentId?: string;
}
export const defaultSettings: BillingSettings = {
  trialDays: 3,
  trialMaxSessions: 1,
  plans: [
    { id: 'monthly', name: 'Monthly', months: 1, amount: 299, maxSessions: 1 },
    { id: 'quarterly', name: 'Quarterly', months: 3, amount: 599, maxSessions: 1 },
    { id: 'half-yearly', name: 'Half yearly', months: 6, amount: 1499, maxSessions: 1 },
    { id: 'yearly', name: 'Yearly', months: 12, amount: 2499, maxSessions: 1 },
  ],
};
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}
export function verifySignature(message: string | Buffer, signature: string, secret: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(message).digest(), Buffer.from(signature, 'hex'));
}
@Injectable()
export class BillingService {
  private fulfillmentQueue: Promise<unknown> = Promise.resolve();
  constructor(@InjectRepository(BillingRecord, 'main') private readonly records: Repository<BillingRecord>) {}
  async settings(): Promise<BillingSettings> {
    const row = await this.records.findOneBy({ id: 'settings' });
    return row
      ? (JSON.parse(row.payload) as BillingSettings)
      : { ...defaultSettings, plans: defaultSettings.plans.map(plan => ({ ...plan })) };
  }
  async saveSettings(settings: BillingSettings) {
    await this.records.upsert({ id: 'settings', payload: JSON.stringify(settings) }, ['id']);
    return settings;
  }
  configured() {
    return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
  }
  async trial() {
    const settings = await this.settings();
    return {
      subscriptionStatus: SubscriptionStatus.TRIAL,
      maxSessions: settings.trialMaxSessions,
      subscriptionExpiresAt: new Date(Date.now() + settings.trialDays * 86400000),
    };
  }
  private async razorpay(path: string, body?: object): Promise<Record<string, unknown>> {
    if (!this.configured())
      throw new ServiceUnavailableException('Razorpay account has not been configured by the administrator');
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new ServiceUnavailableException('Razorpay could not process this request. Please try again.');
    return response.json() as Promise<Record<string, unknown>>;
  }
  async checkout(user: User, planId: string) {
    if (!user.isActive) throw new UnauthorizedException('Account disabled');
    const plan = (await this.settings()).plans.find(p => p.id === planId);
    if (!plan) throw new BadRequestException('Plan is unavailable');
    const amount = Math.round(plan.amount * 100);
    const order = await this.razorpay('orders', { amount, currency: 'INR', receipt: randomUUID() });
    if (typeof order.id !== 'string' || !/^order_[a-zA-Z0-9]+$/.test(order.id))
      throw new ServiceUnavailableException('Razorpay returned an invalid order');
    await this.records.insert({
      id: order.id,
      payload: JSON.stringify({ userId: user.id, plan, amount } satisfies Order),
    });
    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount,
      currency: 'INR',
      name: plan.name,
    };
  }
  async handleCaptured(orderId: string, paymentId: string): Promise<void> {
    // A merchant account may also receive payments for other products. Acknowledge those
    // without repeatedly rejecting delivery or querying another product's payment.
    if (!/^order_[a-zA-Z0-9]+$/.test(orderId)) return;
    if (!(await this.records.findOneBy({ id: orderId }))) return;
    await this.confirm(orderId, paymentId);
  }

  async confirm(orderId: string, paymentId: string, userId?: string) {
    const row = await this.records.findOneBy({ id: orderId });
    if (!row || orderId === 'settings') throw new BadRequestException('Unknown order');
    const order = JSON.parse(row.payload) as Order;
    if (userId && order.userId !== userId) throw new UnauthorizedException('Order belongs to another account');
    const payment = await this.razorpay(`payments/${encodeURIComponent(paymentId)}`);
    if (
      payment.order_id !== orderId ||
      payment.status !== 'captured' ||
      payment.amount !== order.amount ||
      payment.currency !== 'INR'
    ) {
      throw new BadRequestException('Payment is not captured or does not match the order');
    }
    const fulfill = () =>
      this.records.manager.transaction(async manager => {
        // Serialize renewals for this account before reading expiry or fulfillment state.
        await manager
          .createQueryBuilder()
          .update(User)
          .set({ id: () => '"id"' })
          .where('id = :id', { id: order.userId })
          .execute();
        const lockedRow = await manager.findOneByOrFail(BillingRecord, { id: orderId });
        const current = JSON.parse(lockedRow.payload) as Order;
        if (current.fulfilled) return { success: true };
        const user = await manager.findOneByOrFail(User, { id: current.userId });
        const start =
          user.subscriptionStatus === SubscriptionStatus.ACTIVE &&
          user.subscriptionExpiresAt &&
          user.subscriptionExpiresAt > new Date()
            ? user.subscriptionExpiresAt
            : new Date();
        user.subscriptionExpiresAt = addMonths(start, current.plan.months);
        user.subscriptionStatus = SubscriptionStatus.ACTIVE;
        user.plan = SubscriptionPlan.PRO;
        user.maxSessions = current.plan.maxSessions;
        await manager.save(User, user);
        current.fulfilled = true;
        current.paymentId = paymentId;
        lockedRow.payload = JSON.stringify(current);
        await manager.save(BillingRecord, lockedRow);
        return { success: true };
      });
    if (this.records.manager.connection.options.type === 'postgres') return fulfill();
    const result = this.fulfillmentQueue.then(fulfill);
    this.fulfillmentQueue = result.catch(() => undefined);
    return result;
  }
}

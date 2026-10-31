import { useEffect, useState } from 'react';
import { billingApi, type BillingStatus, type BillingSettings } from '../services/api';
import { useRole } from '../hooks/useRole';
import './Billing.css';
type CheckoutResult = { razorpay_payment_id: string; razorpay_signature: string };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}
let checkoutScript: Promise<void> | undefined;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript)
    checkoutScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => {
        checkoutScript = undefined;
        script.remove();
        reject(new Error('Unable to load Razorpay. Please try again.'));
      };
      document.head.appendChild(script);
    });
  return checkoutScript;
}
export function Billing() {
  const { isAdmin } = useRole();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const result = await billingApi.status();
    setStatus(result);
    setSettings(result.settings);
  };
  useEffect(() => {
    refresh().catch(e => setMessage(e.message));
  }, []);
  const pay = async (planId: string) => {
    setBusy(true);
    setMessage('');
    try {
      await loadCheckout();
      const order = await billingApi.checkout(planId);
      if (!window.Razorpay) throw new Error('Razorpay is unavailable');
      new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Waply',
        description: order.name,
        modal: { ondismiss: () => setBusy(false) },
        handler: async (result: CheckoutResult) => {
          try {
            await billingApi.verify({
              orderId: order.orderId,
              paymentId: result.razorpay_payment_id,
              signature: result.razorpay_signature,
            });
            await refresh();
            window.dispatchEvent(new Event('billing-updated'));
            setMessage('Payment received. Your subscription is active.');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Payment confirmation pending. Refresh to check again.');
          } finally {
            setBusy(false);
          }
        },
      }).open();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to start payment');
      setBusy(false);
    }
  };
  return (
    <section className="billing-page">
      <h1>Subscription & billing</h1>
      <p>Try all features, then choose the subscription that suits you.</p>
      {message && (
        <p role="status" className="billing-notice">
          {message}
        </p>
      )}
      {!status || !settings ? (
        <p>Loading billing…</p>
      ) : (
        <>
          {status.account && (
            <div className="billing-notice">
              <strong>{status.account.status.toUpperCase()}</strong> ·{' '}
              {status.account.expiresAt
                ? `Access ends ${new Date(status.account.expiresAt).toLocaleString()}`
                : 'Choose a plan to activate access'}
              <br />
              {!status.access && 'Your trial or subscription has ended. Choose a plan below to continue.'}
            </div>
          )}
          {!status.configured && (
            <p className="billing-notice">Payments are awaiting Razorpay account configuration by the administrator.</p>
          )}
          <div className="billing-plans">
            {settings.plans.map(plan => (
              <article key={plan.id} className="billing-card">
                <h2>{plan.name}</h2>
                <strong>₹{plan.amount.toLocaleString('en-IN')}</strong>
                <p>
                  Every {plan.months} month{plan.months > 1 ? 's' : ''} · {plan.maxSessions} WhatsApp session
                  {plan.maxSessions > 1 ? 's' : ''}
                </p>
                <p>All workspace features included</p>
                <button disabled={busy || !status.configured || !status.account} onClick={() => pay(plan.id)}>
                  Pay with Razorpay
                </button>
              </article>
            ))}
          </div>
          {!settings.plans.length && <p>No plans published yet.</p>}
          <p>
            Subscriptions activate after confirmed payment. Renewal payments are made manually; your card is not charged
            automatically.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              refresh()
                .then(() => window.dispatchEvent(new Event('billing-updated')))
                .catch(e => setMessage(e.message))
            }
          >
            Refresh payment status
          </button>
          {isAdmin && (
            <form
              className="billing-settings"
              onSubmit={async e => {
                e.preventDefault();
                setBusy(true);
                try {
                  await billingApi.save(settings);
                  setMessage('Billing settings saved. Trial changes apply to new accounts.');
                  await refresh();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : 'Could not save');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Billing settings</h2>
              <p>
                Connect your Razorpay account with server settings: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and
                RAZORPAY_WEBHOOK_SECRET. Add the payment.captured webhook at your public API address followed by
                /billing/webhook.
              </p>
              <label>
                Trial days (0–365)
                <input
                  type="number"
                  min="0"
                  max="365"
                  required
                  value={settings.trialDays}
                  onChange={e => setSettings({ ...settings, trialDays: Number(e.target.value) })}
                />
              </label>
              <label>
                Trial WhatsApp sessions
                <input
                  type="number"
                  min="1"
                  max="1000"
                  required
                  value={settings.trialMaxSessions}
                  onChange={e => setSettings({ ...settings, trialMaxSessions: Number(e.target.value) })}
                />
              </label>
              {settings.plans.map((plan, index) => (
                <fieldset key={plan.id}>
                  <legend>Plan {index + 1}</legend>
                  <label>
                    Name
                    <input
                      required
                      maxLength={80}
                      value={plan.name}
                      onChange={e =>
                        setSettings({
                          ...settings,
                          plans: settings.plans.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)),
                        })
                      }
                    />
                  </label>
                  <label>
                    Billing period
                    <select
                      value={plan.months}
                      onChange={e =>
                        setSettings({
                          ...settings,
                          plans: settings.plans.map((p, i) =>
                            i === index ? { ...p, months: Number(e.target.value) } : p,
                          ),
                        })
                      }
                    >
                      {[1, 3, 6, 12].map(n => (
                        <option key={n} value={n}>
                          {n} months
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Price (INR)
                    <input
                      type="number"
                      min="1"
                      max="1000000"
                      step="0.01"
                      required
                      value={plan.amount}
                      onChange={e =>
                        setSettings({
                          ...settings,
                          plans: settings.plans.map((p, i) =>
                            i === index ? { ...p, amount: Number(e.target.value) } : p,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    WhatsApp sessions
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      required
                      value={plan.maxSessions}
                      onChange={e =>
                        setSettings({
                          ...settings,
                          plans: settings.plans.map((p, i) =>
                            i === index ? { ...p, maxSessions: Number(e.target.value) } : p,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, plans: settings.plans.filter((_, i) => i !== index) })}
                  >
                    Remove plan
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                disabled={settings.plans.length >= 20}
                onClick={() =>
                  setSettings({
                    ...settings,
                    plans: [
                      ...settings.plans,
                      { id: crypto.randomUUID(), name: 'New plan', months: 1, amount: 499, maxSessions: 1 },
                    ],
                  })
                }
              >
                Add plan
              </button>{' '}
              <button disabled={busy}>Save settings</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

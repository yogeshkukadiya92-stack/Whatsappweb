import { useEffect, useState } from 'react';
import { billingApi } from '../services/api';
import { useRole } from '../hooks/useRole';
import './Billing.css';
export function SetupHelp() {
  const { isAdmin } = useRole();
  const [phone, setPhone] = useState('');
  const [requests, setRequests] = useState<Awaited<ReturnType<typeof billingApi.setupCalls>>>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isAdmin)
      billingApi
        .setupCalls()
        .then(setRequests)
        .catch(e => setNotice(e.message));
  }, [isAdmin]);
  return (
    <section className="billing-page">
      <h1>Personal setup call</h1>
      <p>
        Get one-to-one help connecting your WhatsApp number, setting up your first workflow and testing it together on a
        call.
      </p>
      {isAdmin ? (
        <>
          <h2>Callback requests</h2>
          {!requests.length && !notice && <p>No pending requests.</p>}
          {requests.map(r => (
            <article key={r.id}>
              <strong>{r.name}</strong> · {r.email} · <a href={'tel:' + r.phone}>{r.phone}</a>{' '}
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await billingApi.completeCall(r.id);
                    setRequests(items => items.filter(x => x.id !== r.id));
                  } catch (e) {
                    setNotice(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Mark completed
              </button>
            </article>
          ))}
        </>
      ) : (
        <form
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            try {
              await billingApi.requestCall(phone.trim());
              setNotice('Request received. We will contact you at ' + phone + ' to arrange your setup call.');
            } catch (e) {
              setNotice(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Callback number with country code{' '}
            <input
              type="tel"
              required
              pattern="[+][1-9][0-9]{7,14}"
              placeholder="+919876543210"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Request a setup call
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

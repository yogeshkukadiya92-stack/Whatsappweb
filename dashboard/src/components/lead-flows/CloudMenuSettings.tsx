import { useEffect, useState } from 'react';
import { API_BASE_URL, cloudMenuApi, type CloudMenuSettings as Settings } from '../../services/api';
import { useToast } from '../../hooks/useToast';

export function CloudMenuSettings({ sessionId }: { sessionId: string }) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [apiVersion, setApiVersion] = useState('v23.0');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [verifyToken, setVerifyToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSettings(null);
    setError('');
    setAccessToken('');
    setAppSecret('');
    setVerifyToken('');
    if (!sessionId || sessionId === 'all') return;
    cloudMenuApi
      .get(sessionId)
      .then(value => {
        if (!active) return;
        setSettings(value);
        setPhoneNumberId(value.phoneNumberId);
        setApiVersion(value.apiVersion);
        setEnabled(value.enabled);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load Business API settings.');
      });
    return () => {
      active = false;
    };
  }, [sessionId]);
  const callback = settings?.webhookPath
    ? `${new URL(API_BASE_URL, window.location.origin).href}${settings.webhookPath.replace(/^\/api/, '')}`
    : '';
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await cloudMenuApi.save(sessionId, {
        phoneNumberId,
        apiVersion,
        enabled,
        accessToken: accessToken || undefined,
        appSecret: appSecret || undefined,
      });
      setSettings(result);
      setAccessToken('');
      setAppSecret('');
      if (result.verifyToken) setVerifyToken(result.verifyToken);
      toast.success('WhatsApp Business API settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="cloud-menu-settings">
      <summary>WhatsApp Business API — Native Reply Buttons</summary>
      <p>
        Use your Meta WhatsApp Business API number for native buttons. Your QR-connected number can continue using polls
        with the same resource menu.
      </p>
      {!sessionId || sessionId === 'all' ? (
        <p>Select a specific WhatsApp session to configure the Business API connection.</p>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          {!settings ? (
            <p>{error ? 'Settings unavailable.' : 'Loading connection settings…'}</p>
          ) : (
            <>
              {!settings.vaultReady && (
                <p role="alert">
                  Your administrator must configure STUDIO_VAULT_KEY on the server before credentials can be saved.
                </p>
              )}
              <form onSubmit={save}>
                <div className="cloud-menu-fields">
                  <label>
                    Meta Phone Number ID
                    <input
                      aria-label="Meta Phone Number ID"
                      value={phoneNumberId}
                      onChange={event => setPhoneNumberId(event.target.value)}
                      pattern="[0-9]{5,30}"
                      required
                    />
                  </label>
                  <label>
                    Graph API version
                    <input
                      aria-label="Graph API version"
                      value={apiVersion}
                      onChange={event => setApiVersion(event.target.value)}
                      pattern="v[0-9]{1,2}\.[0-9]{1,2}"
                      required
                    />
                  </label>
                  <label>
                    Access Token
                    <input
                      aria-label="Meta Access Token"
                      type="password"
                      autoComplete="new-password"
                      value={accessToken}
                      onChange={event => setAccessToken(event.target.value)}
                      placeholder={settings.configured ? 'Saved securely; leave blank to keep' : 'Paste from Meta'}
                      required={!settings.configured}
                    />
                  </label>
                  <label>
                    Meta App Secret
                    <input
                      aria-label="Meta App Secret"
                      type="password"
                      autoComplete="new-password"
                      value={appSecret}
                      onChange={event => setAppSecret(event.target.value)}
                      placeholder={
                        settings.configured ? 'Saved securely; leave blank to keep' : 'Paste from Meta App settings'
                      }
                      required={!settings.configured}
                    />
                  </label>
                </div>
                <label>
                  <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{' '}
                  Enable native button responses
                </label>
                <button className="btn-primary" disabled={busy || !settings.vaultReady} type="submit">
                  {busy ? 'Saving…' : 'Save Business API Connection'}
                </button>
              </form>
              {callback && (
                <div className="form-group">
                  <label>
                    Meta webhook callback URL
                    <input readOnly value={callback} aria-label="Meta webhook callback URL" />
                  </label>
                </div>
              )}
              {verifyToken && (
                <div className="form-group">
                  <label>
                    Webhook Verify Token — copy now
                    <input readOnly value={verifyToken} aria-label="Webhook Verify Token" />
                  </label>
                  <small>This token is shown once. Enter it in Meta alongside the callback URL.</small>
                </div>
              )}
              {settings.configured && (
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setVerifyToken((await cloudMenuApi.rotate(sessionId)).verifyToken);
                      toast.success('New Verify Token generated; update it in Meta');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not rotate token.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Generate New Verify Token
                </button>
              )}
              <ol>
                <li>
                  In your Meta app, configure the callback URL and Verify Token, then subscribe to the WhatsApp{' '}
                  <strong>messages</strong> webhook.
                </li>
                <li>
                  Create a resource menu below and turn on <strong>Also use native Business API buttons</strong>. Use
                  2–3 choices, each with a resource and a title of up to 20 characters.
                </li>
                <li>
                  Send its trigger word to the Business API number, then tap a reply button to receive the resource.
                </li>
              </ol>
            </>
          )}
        </>
      )}
    </details>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useRole } from '../../hooks/useRole';
import { studioApi, type StudioConnection } from '../../services/api';

const empty = {
  name: '',
  kind: 'api' as StudioConnection['kind'],
  allowedTools: [] as string[],
  baseUrl: 'https://',
  auth: 'bearer' as StudioConnection['auth'],
  headerName: '',
  enabled: true,
};
export function StudioConnections({
  session,
  onChange,
}: {
  session: string;
  onChange: (connections: StudioConnection[]) => void;
}) {
  const { role } = useRole();
  const admin = role === 'admin';
  const live = useRef(false);
  const [connections, setConnections] = useState<StudioConnection[]>([]);
  const [draft, setDraft] = useState(empty);
  const [id, setId] = useState<string>();
  const [secret, setSecret] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    live.current = true;
    let cancelled = false;
    setDraft(empty);
    setId(undefined);
    setSecret('');
    setConnections([]);
    setError('');
    setReady(false);
    if (session)
      studioApi
        .connections(session)
        .then(result => {
          if (!cancelled) {
            setConnections(result.connections);
            setReady(result.vaultReady);
          }
        })
        .catch(() => {
          if (!cancelled) setError('Could not load connections.');
        });
    return () => {
      cancelled = true;
      live.current = false;
    };
  }, [session]);
  async function refresh() {
    const result = await studioApi.connections(session);
    if (!live.current) return;
    setConnections(result.connections);
    onChange(result.connections);
    setReady(result.vaultReady);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await studioApi.saveConnection(session, { ...draft, ...(draft.auth !== 'none' && secret ? { secret } : {}) }, id);
      setSecret('');
      setDraft(empty);
      setId(undefined);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save connection.');
      setSecret('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="studio-history studio-connections">
      <h3>Connections · API &amp; MCP</h3>
      <p className="studio-muted">
        Administrators manage credentials. Workflows can read approved APIs and explicitly permitted MCP tools; secrets
        never appear in workflow definitions. OAuth is not available yet.
      </p>
      {!ready && (
        <p role="status">
          Credential vault needs administrator setup (STUDIO_VAULT_KEY). Public connections still work.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!admin && <p>Administrator permission is required to manage connections.</p>}
      <div className="studio-connection-grid">
        {connections.map(connection => (
          <article className="studio-connection-card" key={connection.id}>
            <h4>
              {connection.name} · {connection.enabled ? 'Active' : 'Disabled'}
            </h4>
            <p>{connection.baseUrl}</p>
            <small>
              {connection.auth} ·{' '}
              {connection.kind === 'mcp'
                ? `MCP · ${connection.allowedTools.join(', ') || 'no tools approved'}`
                : 'GET only'}
            </small>
            <button
              disabled={busy || !admin}
              onClick={() => {
                setId(connection.id);
                setDraft({
                  name: connection.name,
                  kind: connection.kind,
                  allowedTools: connection.allowedTools,
                  baseUrl: connection.baseUrl,
                  auth: connection.auth,
                  headerName: connection.headerName,
                  enabled: connection.enabled,
                });
                setSecret('');
              }}
            >
              Edit
            </button>
            {connection.kind === 'mcp' && (
              <button
                disabled={busy || !admin}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const tools = await studioApi.discoverTools(session, connection.id);
                    setId(connection.id);
                    setSecret('');
                    setDraft({
                      name: connection.name,
                      kind: connection.kind,
                      allowedTools: connection.allowedTools,
                      baseUrl: connection.baseUrl,
                      auth: connection.auth,
                      headerName: connection.headerName,
                      enabled: connection.enabled,
                    });
                    setError(
                      `Read-only tools found: ${tools.map(tool => tool.name).join(', ') || 'none'}. Enter approved names below and save.`,
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not discover tools.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Discover read-only tools
              </button>
            )}
            <button
              disabled={busy || !admin}
              onClick={async () => {
                if (!window.confirm(`Delete ${connection.name}? Workflows using it will stop at the connection step.`))
                  return;
                setBusy(true);
                setError('');
                try {
                  await studioApi.removeConnection(session, connection.id);
                  await refresh();
                } catch {
                  setError('Could not delete connection. Administrator permission is required.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete
            </button>
          </article>
        ))}
      </div>
      <form onSubmit={save} className="studio-inspector">
        <h4>{id ? 'Edit connection' : 'Add connection'}</h4>
        <fieldset disabled={busy || !admin} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <label className="studio-field">
            Name
            <input
              required
              maxLength={100}
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="studio-field">
            Connection type
            <select
              value={draft.kind}
              onChange={e => setDraft({ ...draft, kind: e.target.value as StudioConnection['kind'], allowedTools: [] })}
            >
              <option value="api">API · read-only GET</option>
              <option value="mcp">MCP · JSON Streamable HTTP</option>
            </select>
          </label>
          <label className="studio-field">
            Approved HTTPS base URL
            <input
              required
              value={draft.baseUrl}
              onChange={e => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1/"
            />
          </label>
          <label className="studio-field">
            Authentication
            <select
              value={draft.auth}
              onChange={e => {
                setSecret('');
                setDraft({ ...draft, auth: e.target.value as StudioConnection['auth'] });
              }}
            >
              <option value="none">Public · no credential</option>
              <option value="bearer">Bearer token</option>
              <option value="apiKey">API key header</option>
              <option value="basic">Basic · username:password</option>
            </select>
          </label>
          {draft.auth === 'apiKey' && (
            <label className="studio-field">
              Header name
              <input
                required
                value={draft.headerName}
                placeholder="X-API-Key"
                onChange={e => setDraft({ ...draft, headerName: e.target.value })}
              />
            </label>
          )}
          {draft.auth !== 'none' && (
            <label className="studio-field">
              {id ? 'New credential (leave blank to preserve)' : 'Credential'}
              <input
                type="password"
                autoComplete="new-password"
                maxLength={4000}
                value={secret}
                onChange={e => setSecret(e.target.value)}
              />
            </label>
          )}
          <label className="studio-connection-toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
            />{' '}
            Enabled
          </label>
          {draft.kind === 'mcp' && (
            <label className="studio-field">
              Approved tool names (comma separated)
              <input
                value={draft.allowedTools.join(', ')}
                onChange={e => setDraft({ ...draft, allowedTools: e.target.value.split(',').map(name => name.trim()) })}
              />
              <small>
                Save, discover tools, then explicitly approve names. Read-only annotations are server claims: connect
                trusted servers only.
              </small>
            </label>
          )}
          <p className="studio-muted">
            Changing the URL or authentication requires a fresh credential. Basic uses username:password. Only connect
            trusted tools.
          </p>
          <button type="submit" disabled={!session || (draft.auth !== 'none' && !ready && !id)}>
            Save connection
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(empty);
              setId(undefined);
              setSecret('');
            }}
          >
            Clear
          </button>
        </fieldset>
      </form>
    </section>
  );
}

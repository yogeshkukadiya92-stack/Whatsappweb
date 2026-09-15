import { useEffect, useRef, useState } from 'react';
import { studioApi, type StudioConnection, type StudioDraft } from '../../services/api';

export function StudioAiBuilder({
  session,
  connections,
  onApply,
}: {
  session: string;
  connections: StudioConnection[];
  onApply: (draft: StudioDraft) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<StudioDraft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDraft(undefined);
    try {
      const result = await studioApi.generateDraft(
        session,
        prompt,
        selected.filter(id => connections.some(connection => connection.id === id && connection.enabled)),
      );
      if (alive.current) setDraft(result);
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : 'Could not generate draft.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="studio-ai-builder">
      <summary>Build with AI · describe your workflow</summary>
      <form onSubmit={generate}>
        <fieldset disabled={busy}>
          <label className="studio-field">
            What should this workflow do?
            <textarea
              required
              minLength={10}
              maxLength={3000}
              rows={3}
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                setDraft(undefined);
              }}
              placeholder="https://example.com પરથી માહિતી લઈ customerના પ્રશ્નનો ગુજરાતીમાં જવાબ આપો…"
            />
          </label>
          <p className="studio-muted">
            Include exact public HTTPS URLs. Do not enter passwords or private customer data. Generation sends your
            request to the session AI provider and may incur charges. It never calls your tools or sends WhatsApp
            messages.
          </p>
          {connections.some(connection => connection.enabled) && (
            <div className="studio-ai-permissions">
              <p>Connections AI may use (optional, maximum 5)</p>
              {connections
                .filter(connection => connection.enabled)
                .map(connection => (
                  <label key={connection.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(connection.id)}
                      disabled={!selected.includes(connection.id) && selected.length >= 5}
                      onChange={e => {
                        setSelected(ids =>
                          e.target.checked ? [...ids, connection.id] : ids.filter(id => id !== connection.id),
                        );
                        setDraft(undefined);
                      }}
                    />
                    {connection.name} · {connection.kind}
                  </label>
                ))}
            </div>
          )}
          <button type="submit" disabled={!session || prompt.trim().length < 10}>
            {busy ? 'Creating draft…' : 'Generate workflow draft'}
          </button>
          <small className="studio-muted">
            {' '}
            One generation at a time · up to 6 attempts/hour/session. No automatic paid retries.
          </small>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {draft && (
        <div className="studio-ai-review" aria-live="polite">
          <h3>{draft.name}</h3>
          <p>{draft.explanation}</p>
          <ol>
            {draft.definition.steps.map(step => (
              <li key={step.id}>
                {step.label} <small>({step.type})</small>
              </li>
            ))}
          </ol>
          <ul>
            {draft.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          <details>
            <summary>Review all generated settings</summary>
            <pre>{JSON.stringify(draft.definition, null, 2)}</pre>
          </details>
          <p className="studio-muted">
            Use draft creates a new unsaved draft in the editor. Existing published workflows keep running. Saving,
            testing and publishing are separate actions.
          </p>
          <button type="button" onClick={() => onApply(draft)}>
            Use reviewed draft
          </button>
          <button type="button" onClick={() => setDraft(undefined)}>
            Discard suggestion
          </button>
        </div>
      )}
    </details>
  );
}

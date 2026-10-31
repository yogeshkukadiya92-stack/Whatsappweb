import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Pause, Play } from 'lucide-react';
import { useSessionsQuery } from '../hooks/queries';
import { studioApi, type StudioWorkflow } from '../services/api';
import { useRole } from '../hooks/useRole';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { simpleReply } from '../utils/simpleReply';
import './Automations.css';

export function Automations() {
  useDocumentTitle('Automations');
  const { canWrite } = useRole();
  const client = useQueryClient();
  const accounts = useSessionsQuery();
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('session') || '');
  const account = accounts.data?.find(a => a.id === selected) ?? accounts.data?.[0];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [reply, setReply] = useState('');
  const flows = useQuery({
    queryKey: ['studio', 'workflows', account?.id],
    queryFn: () => studioApi.list(account!.id),
    enabled: !!account,
    staleTime: 30_000,
  });
  const save = useMutation({
    mutationFn: (flow: Pick<StudioWorkflow, 'name' | 'enabled' | 'definition'> & { id?: string; sessionId: string }) =>
      studioApi.save(flow.sessionId, flow, flow.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['studio', 'workflows'] });
      setCreating(false);
    },
  });
  return (
    <div className="automations-page">
      <PageHeader title="Automations" subtitle="Choose what replies automatically. Pause whenever you need." />
      <div className="automations-toolbar">
        <label>
          WhatsApp account
          <select
            value={account?.id ?? ''}
            onChange={e => {
              setSelected(e.target.value);
              setCreating(false);
              save.reset();
            }}
            disabled={save.isPending}
          >
            {!accounts.data?.length && <option value="">No accounts</option>}
            {accounts.data?.map(a => (
              <option key={a.id} value={a.id}>
                {a.name || a.id} · {a.status}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setCreating(true);
            save.reset();
          }}
          disabled={!canWrite || !account || save.isPending}
        >
          <Plus size={18} /> New auto-reply
        </button>
      </div>
      <div className="automation-help">
        <MessageSquare size={24} />
        <div>
          <strong>You’re in control</strong>
          <p>
            New replies are saved as drafts. Activate only when you are ready. These controls manage Studio workflows;{' '}
            <Link to="/ai-chatbot">AI chatbot</Link> and <Link to="/lead-capture">lead flows</Link> have separate
            controls.
          </p>
        </div>
      </div>
      {save.isError && <p role="alert">Could not save your changes. {save.error.message}</p>}
      {save.isSuccess && <p role="status">Saved successfully.</p>}
      {creating && (
        <form
          className="automation-editor"
          onSubmit={e => {
            e.preventDefault();
            if (!account || !canWrite) return;
            save.mutate({ sessionId: account.id, ...simpleReply(name, keywords, reply) });
          }}
        >
          <h2>Create a simple auto-reply</h2>
          <label>
            Name
            <input
              required
              maxLength={100}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Welcome reply"
              pattern=".*\S.*"
            />
          </label>
          <label>
            Reply when a message contains
            <input required value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="hello, hi" />
          </label>
          <p>Separate keywords with commas. Applies to personal chats only, with a 60-second cooldown.</p>
          <label>
            Your reply
            <textarea
              required
              rows={4}
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Write your reply…"
            />
          </label>
          <div>
            <button
              disabled={save.isPending || !reply.trim() || !name.trim() || !keywords.split(',').some(k => k.trim())}
            >
              Save as draft
            </button>
            <button type="button" disabled={save.isPending} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {accounts.isPending || (!!account && flows.isPending) ? (
        <p>Loading automations…</p>
      ) : accounts.isError || flows.isError ? (
        <p role="alert">
          Could not load automations.{' '}
          <button
            onClick={() => {
              void accounts.refetch();
              void flows.refetch();
            }}
          >
            Try again
          </button>
        </p>
      ) : !account ? (
        <p>
          <Link to="/sessions">Connect WhatsApp</Link> to create an automation.
        </p>
      ) : (
        <div className="automation-cards">
          {!flows.data?.length && <p>No automations yet. Create your first reply above.</p>}
          {flows.data?.map(flow => (
            <article className="automation-card" key={flow.id}>
              <div className="automation-card-title">
                <MessageSquare size={22} />
                <h2>{flow.name}</h2>
                <span>{flow.enabled ? 'Active' : 'Inactive'}</span>
              </div>
              <p>
                {flow.definition.trigger?.type && flow.definition.trigger.type !== 'whatsapp'
                  ? `${flow.definition.trigger.type} trigger`
                  : flow.definition.keywords.length
                    ? `When: ${flow.definition.keywords.join(', ')}`
                    : 'When: any incoming message'}
              </p>
              <p>
                Audience: {flow.definition.audience} · {flow.definition.steps.length} steps
              </p>
              {flow.definition.steps
                .filter(step => step.type === 'reply')
                .map(step => (
                  <blockquote key={step.id}>{step.config.text}</blockquote>
                ))}
              <div className="automation-card-actions">
                <button
                  disabled={!canWrite || save.isPending}
                  onClick={() => save.mutate({ ...flow, enabled: !flow.enabled })}
                >
                  {flow.enabled ? <Pause size={16} /> : <Play size={16} />}
                  {flow.enabled ? 'Pause' : 'Activate'}
                </button>
                <Link
                  to={`/automation-studio?session=${encodeURIComponent(account.id)}&workflow=${encodeURIComponent(flow.id)}`}
                >
                  Edit in builder →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <footer>
        <Link to={`/automation-studio${account ? `?session=${encodeURIComponent(account.id)}` : ''}`}>
          Advanced workflow builder & execution history →
        </Link>
      </footer>
    </div>
  );
}

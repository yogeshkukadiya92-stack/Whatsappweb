import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CheckCircle2,
  Circle,
  Filter,
  Globe,
  GitBranch,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Play,
  Trash2,
  X,
  Clock,
  Repeat,
  Layers,
  Sparkles,
  Phone,
  Users,
} from 'lucide-react';
import {
  studioApi,
  API_BASE_URL,
  type StudioWorkflow,
  type StudioDefinition,
  type StudioStep,
  type StudioStepType,
  type StudioExecution,
} from '../services/api';
import { useSessionsQuery, useSessionChatsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import './AutomationStudio.css';
import { StudioConnections } from '../components/studio/StudioConnections';
import { hasStudioOAuthCallback, studioOAuthCallbackSession } from '../utils/studioOAuthCallback';
import { StudioAiBuilder } from '../components/studio/StudioAiBuilder';
import type { StudioConnection } from '../services/api';
import { StudioRouterEditor } from '../components/studio/StudioRouterEditor';

const stepCatalog = {
  mcp: {
    label: 'MCP tool',
    description: 'Read from an explicitly approved tool',
    icon: Braces,
    config: { connectionId: '', tool: '', arguments: '{}', output: 'toolResult' },
  },
  website: {
    label: 'Website text',
    description: 'Read a public website without scripts',
    icon: Globe,
    config: { url: 'https://example.com', output: 'site', mode: 'auto', maxChars: '20000' },
  },
  ai: {
    label: 'AI processing',
    description: 'Summarize, answer, extract or translate',
    icon: Sparkles,
    config: {
      task: 'summarize',
      input: '{{site.text}}',
      question: '{{message}}',
      output: 'answer',
      instructions: 'Keep the result concise and suitable for WhatsApp.',
      language: 'auto',
      fields: 'name, price',
    },
  },
  router: {
    label: 'Router',
    description: 'Choose the first matching branch',
    icon: GitBranch,
    config: { routes: '[]', fallback: 'end' },
  },
  delay: { label: 'Delay', description: 'Wait and resume automatically', icon: Clock, config: { seconds: '60' } },
  iterator: {
    label: 'Iterator',
    description: 'Process each item in a list',
    icon: Repeat,
    config: { array: '{{api.items}}', alias: 'item', end: '' },
  },
  aggregator: {
    label: 'Aggregator',
    description: 'Combine processed items',
    icon: Layers,
    config: { output: 'summary', value: '{{item}}', format: 'text', separator: '\n' },
  },
  variable: {
    label: 'Set variable',
    description: 'Prepare a value for the next step',
    icon: Braces,
    config: { name: 'customer', value: '{{message}}' },
  },
  filter: {
    label: 'Filter',
    description: 'Continue only when a condition passes',
    icon: Filter,
    config: { value: '{{message}}', operator: 'contains', expected: 'hello' },
  },
  http: {
    label: 'API request',
    description: 'Fetch data from an HTTPS endpoint',
    icon: Globe,
    config: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', output: 'api', body: '{}' },
  },
  reply: {
    label: 'WhatsApp reply',
    description: 'Send a personalized response',
    icon: MessageSquare,
    config: { text: 'Thanks! We received: {{message}}' },
  },
};
function newStep(type: StudioStepType): StudioStep {
  return { id: crypto.randomUUID(), type, label: stepCatalog[type].label, config: { ...stepCatalog[type].config } };
}
function initialDefinition(): StudioDefinition {
  return { keywords: ['hello', 'hi'], audience: 'direct', cooldownSeconds: 60, steps: [newStep('reply')] };
}

export default function AutomationStudio() {
  const { data: sessions = [] } = useSessionsQuery();
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const [session, setSession] = useState('');
  const { data: sessionChats = [] } = useSessionChatsQuery(session, Boolean(session));
  const [customTargetInput, setCustomTargetInput] = useState('');
  const directChats = useMemo(
    () => sessionChats.filter(c => !c.isGroup && !c.id.endsWith('@g.us')),
    [sessionChats],
  );
  const groupChats = useMemo(
    () => sessionChats.filter(c => c.isGroup || c.id.endsWith('@g.us')),
    [sessionChats],
  );
  const [workflows, setWorkflows] = useState<StudioWorkflow[]>([]);
  const [logs, setLogs] = useState<StudioExecution[]>([]);
  const [tab, setTab] = useState<'builder' | 'executions' | 'connections'>(() =>
    hasStudioOAuthCallback() ? 'connections' : 'builder',
  );
  const [connections, setConnections] = useState<StudioConnection[]>([]);
  useEffect(() => {
    let cancelled = false;
    setConnections([]);
    if (session)
      studioApi
        .connections(session)
        .then(result => {
          if (!cancelled) setConnections(result.connections);
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);
  const [id, setId] = useState<string>();
  const [name, setName] = useState('Customer welcome');
  const [enabled, setEnabled] = useState(false);
  const [definition, setDefinition] = useState<StudioDefinition>(initialDefinition);
  const [selected, setSelected] = useState<string>('trigger');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('hello');
  const [result, setResult] = useState<StudioExecution | null>(null);
  const [expandedLog, setExpandedLog] = useState<string>();
  const [hookSample, setHookSample] = useState('{"name":"Customer"}');
  const [hookSecret, setHookSecret] = useState<{ token: string; path: string; header: string }>();
  useEffect(() => {
    setHookSecret(undefined);
  }, [session, id]);
  useEffect(() => {
    if (!session || tab !== 'executions') return;
    let active = true;
    const timer = window.setInterval(() => {
      void studioApi
        .logs(session)
        .then(items => {
          if (active) setLogs(items);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session, tab]);
  useEffect(() => {
    if (!session && sessions.length) {
      const original = studioOAuthCallbackSession();
      setSession(sessions.find(item => item.id === original)?.id || sessions[0].id);
    }
  }, [sessions, session]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setWorkflows([]);
    setLogs([]);
    setId(undefined);
    setResult(null);
    setDirty(false);
    setEnabled(false);
    setName('Customer welcome');
    setDefinition(initialDefinition());
    setSelected('trigger');
    Promise.all([studioApi.list(session), studioApi.logs(session)])
      .then(([items, executions]) => {
        if (active) {
          setWorkflows(items);
          setLogs(executions);
        }
      })
      .catch(error => {
        if (active)
          toastRef.current.error('Could not load workflows', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session]);
  const edit = (change: Partial<StudioDefinition>) => {
    setDefinition(current => ({ ...current, ...change }));
    setDirty(true);
    setResult(null);
  };
  const currentStep = definition.steps.find(step => step.id === selected);
  const laterSteps = currentStep ? definition.steps.slice(definition.steps.indexOf(currentStep) + 1) : [];
  const trigger = definition.trigger || { type: 'whatsapp' as const };
  const patchTrigger = (change: Partial<NonNullable<StudioDefinition['trigger']>>) =>
    edit({ trigger: { ...trigger, ...change } });
  const addStep = (type: StudioStepType) => {
    if (definition.steps.length + (type === 'iterator' ? 2 : 1) > 20) return;
    const step = newStep(type);
    const additions = [step];
    if (type === 'iterator') {
      const end = newStep('aggregator');
      step.config.end = end.id;
      additions.push(end);
    }
    if (type === 'router')
      step.config.routes = JSON.stringify([
        { label: 'Match', value: '{{message}}', operator: 'contains', expected: 'hello', target: 'end' },
      ]);
    edit({ steps: [...definition.steps, ...additions] });
    setSelected(step.id);
  };
  const patchStep = (config: Record<string, string>) =>
    edit({
      steps: definition.steps.map(step =>
        step.id === selected ? { ...step, config: { ...step.config, ...config } } : step,
      ),
    });
  const open = (workflow: StudioWorkflow) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setId(workflow.id);
    setName(workflow.name);
    setEnabled(workflow.enabled);
    setDefinition(workflow.definition);
    setSelected('trigger');
    setDirty(false);
    setResult(null);
    setTab('builder');
  };
  const create = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setId(undefined);
    setName('New workflow');
    setEnabled(false);
    setDefinition(initialDefinition());
    setSelected('trigger');
    setDirty(true);
    setResult(null);
    setTab('builder');
  };
  const save = async (publish = enabled) => {
    if (!session || !name.trim() || !definition.steps.length) {
      toast.error('Add a name and at least one step');
      return undefined;
    }
    const saved = await studioApi.save(session, { name: name.trim(), enabled: publish, definition }, id);
    setId(saved.id);
    setEnabled(saved.enabled);
    setDirty(false);
    setWorkflows(items => [...items.filter(item => item.id !== saved.id), saved]);
    return saved;
  };
  const perform = async (action: 'save' | 'publish' | 'test' | 'delete' | 'token') => {
    setBusy(true);
    try {
      if (action === 'delete' && id) {
        if (!window.confirm(`Delete "${name}"?`)) return;
        await studioApi.remove(session, id);
        setWorkflows(items => items.filter(item => item.id !== id));
        setId(undefined);
        setEnabled(false);
        setDefinition(initialDefinition());
        setName('New workflow');
        setResult(null);
        setDirty(false);
        toast.success('Workflow deleted');
      } else {
        const saved = await save(action === 'publish' ? !enabled : enabled);
        if (!saved) return;
        if (action === 'test') {
          const payload: unknown = trigger.type === 'webhook' ? JSON.parse(hookSample) : undefined;
          if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload)))
            throw new Error('Webhook sample must be a JSON object.');
          const execution = await studioApi.test(
            session,
            saved.id,
            message,
            payload as Record<string, unknown> | undefined,
          );
          setResult(execution);
          setLogs(await studioApi.logs(session));
        } else if (action === 'token') {
          setHookSecret(await studioApi.webhookToken(session, saved.id));
          toast.success('New webhook token generated', 'Previous tokens no longer work. Copy this token now.');
        } else
          toast.success(
            action === 'publish' ? (saved.enabled ? 'Workflow published' : 'Workflow paused') : 'Workflow saved',
          );
      }
    } catch (error) {
      toast.error('Action failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const reorder = (index: number, direction: number) => {
    const steps = [...definition.steps];
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    edit({ steps });
  };
  const field = (label: string, key: string, placeholder?: string, multiline = false) => (
    <label className="studio-field">
      {label}
      {multiline ? (
        <textarea
          rows={4}
          value={currentStep?.config[key] || ''}
          placeholder={placeholder}
          onChange={e => patchStep({ [key]: e.target.value })}
        />
      ) : (
        <input
          value={currentStep?.config[key] || ''}
          placeholder={placeholder}
          onChange={e => patchStep({ [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <div className="automation-studio">
      <PageHeader title="Automation Studio" subtitle="Connect your data. Build a flow. Bring answers to WhatsApp." />
      <div className="studio-topbar">
        <label>
          WhatsApp session{' '}
          <select
            aria-label="WhatsApp session"
            value={session}
            disabled={busy}
            onChange={e => {
              if (!dirty || window.confirm('Discard unsaved changes?')) setSession(e.target.value);
            }}
          >
            <option value="" disabled>
              Select a session
            </option>
            {sessions.map(item => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.status})
              </option>
            ))}
          </select>
        </label>
        <div className="studio-tabs">
          <button className={tab === 'builder' ? 'active' : ''} onClick={() => setTab('builder')}>
            <GitBranch size={15} /> Builder
          </button>
          <button
            className={tab === 'executions' ? 'active' : ''}
            onClick={async () => {
              setTab('executions');
              if (session)
                try {
                  setLogs(await studioApi.logs(session));
                } catch {
                  toast.error('Could not refresh executions');
                }
            }}
          >
            Executions <span>{logs.length}</span>
          </button>
          <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}>
            Connections
          </button>
        </div>
      </div>
      {!sessions.length && <div className="studio-empty">Create a WhatsApp session to start building workflows.</div>}
      {loading ? (
        <div className="studio-empty">
          <Loader2 className="animate-spin" /> Loading workflows…
        </div>
      ) : tab === 'connections' ? (
        <StudioConnections key={session} session={session} onChange={setConnections} />
      ) : tab === 'executions' ? (
        <section className="studio-history">
          <div className="studio-section-title">
            <h3>Execution history</h3>
            <small>Latest 50 runs · test runs never send WhatsApp messages</small>
          </div>
          {!logs.length ? (
            <div className="studio-empty">No runs yet. Save a workflow and test it from the builder.</div>
          ) : (
            logs.map(log => (
              <div className="studio-log" key={log.id}>
                <button onClick={() => setExpandedLog(expandedLog === log.id ? undefined : log.id)}>
                  <span className={`studio-status ${log.status}`}>{log.status}</span>
                  <strong>{log.workflowName}</strong>
                  <span>{log.test ? 'Test' : 'Live'}</span>
                  <time>{new Date(log.createdAt).toLocaleString()}</time>
                  <span>{log.durationMs} ms</span>
                </button>
                {['queued', 'waiting', 'running'].includes(log.status) && (
                  <div className="studio-run-actions">
                    <small>
                      {log.nextRunAt ? `Next checkpoint: ${new Date(log.nextRunAt).toLocaleString()}` : 'Processing…'}
                    </small>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await studioApi.cancel(session, log.id);
                          setLogs(await studioApi.logs(session));
                        } catch (error) {
                          toast.error('Could not cancel run', String(error));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Cancel run
                    </button>
                  </div>
                )}
                {expandedLog === log.id && <Trace execution={log} />}
              </div>
            ))
          )}
        </section>
      ) : (
        <>
          <StudioAiBuilder
            key={session}
            session={session}
            connections={connections}
            onApply={draft => {
              if (busy) return;
              if (
                dirty &&
                !window.confirm('Replace unsaved editor changes with this AI draft? Saved workflows are not changed.')
              )
                return;
              setId(undefined);
              setName(draft.name);
              setEnabled(false);
              setDefinition(draft.definition);
              setSelected('trigger');
              setResult(null);
              setHookSecret(undefined);
              setDirty(true);
            }}
          />
          <div className="studio-workspace">
            <aside className="studio-library">
              <div className="studio-section-title">
                <h3>Workflows</h3>
                <button aria-label="New workflow" onClick={create} disabled={busy}>
                  <Plus size={18} />
                </button>
              </div>
              {!workflows.length && <p className="studio-muted">Your saved flows appear here.</p>}
              {workflows.map(item => (
                <button
                  key={item.id}
                  className={`studio-workflow-link ${id === item.id ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => open(item)}
                >
                  <Circle size={8} fill={item.enabled ? '#10b981' : 'currentColor'} />
                  <span>
                    {item.name}
                    <small>
                      {item.definition.steps.length} steps · {item.enabled ? 'Published' : 'Draft'}
                    </small>
                  </span>
                </button>
              ))}
              <div className="studio-section-title studio-palette-heading">
                <h3>Add a step</h3>
              </div>
              {(Object.keys(stepCatalog) as StudioStepType[]).map(type => {
                const item = stepCatalog[type];
                const Icon = item.icon;
                return (
                  <button
                    key={type}
                    className="studio-palette-item"
                    draggable
                    onDragStart={e => e.dataTransfer.setData('studio/type', type)}
                    disabled={busy || definition.steps.length >= 20}
                    onClick={() => addStep(type)}
                  >
                    <Icon size={18} />
                    <span>
                      {item.label}
                      <small>{item.description}</small>
                    </span>
                    <Plus size={13} />
                  </button>
                );
              })}
              <button
                className="studio-palette-item"
                disabled={busy}
                onClick={() => {
                  if (dirty && !window.confirm('Replace unsaved changes with the website answer template?')) return;
                  const website = newStep('website');
                  const ai = newStep('ai');
                  ai.config.task = 'answer';
                  const reply = newStep('reply');
                  reply.config.text = '{{answer}}\nSource: {{site.url}}';
                  setId(undefined);
                  setEnabled(false);
                  setName('Website answer assistant');
                  edit({
                    ...initialDefinition(),
                    trigger: { type: 'whatsapp' },
                    keywords: ['info', 'website'],
                    steps: [website, ai, reply],
                  });
                  setSelected(website.id);
                }}
              >
                <Sparkles size={18} />
                <span>
                  Website answer template<small>Website → AI → WhatsApp</small>
                </span>
              </button>
              <p className="studio-muted studio-palette-tip">
                Click or drag a step onto the canvas. Use arrows to change its order.
              </p>
            </aside>
            <section className="studio-flow-panel">
              <div className="studio-flow-toolbar">
                <input
                  aria-label="Workflow name"
                  value={name}
                  maxLength={100}
                  disabled={busy}
                  onChange={e => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
                <span className={`studio-status ${enabled ? 'success' : ''}`}>
                  {dirty ? 'Unsaved' : enabled ? 'Published' : 'Draft'}
                </span>
                <button
                  className="studio-icon-button"
                  disabled={busy || !id}
                  onClick={() => void perform('delete')}
                  aria-label="Delete workflow"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div
                className="studio-canvas"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const type = e.dataTransfer.getData('studio/type') as StudioStepType;
                  if (type in stepCatalog && !busy && definition.steps.length < 20) {
                    addStep(type);
                  }
                }}
              >
                <button
                  className={`studio-node studio-trigger ${selected === 'trigger' ? 'selected' : ''}`}
                  onClick={() => setSelected('trigger')}
                >
                  <span className="studio-node-icon">
                    <MessageSquare size={20} />
                  </span>
                  <span>
                    <small>TRIGGER</small>
                    <strong>
                      {trigger.type === 'schedule'
                        ? 'Recurring schedule'
                        : trigger.type === 'webhook'
                          ? 'Incoming webhook'
                          : 'WhatsApp message'}
                    </strong>
                    <em>
                      {trigger.type === 'whatsapp'
                        ? `${
                            definition.audience === 'specific_numbers'
                              ? `Specific Numbers (${(definition.targetChats || []).length})`
                              : definition.audience === 'specific_groups'
                                ? `Specific Groups (${(definition.targetChats || []).length})`
                                : definition.audience === 'groups'
                                  ? 'All Groups'
                                  : definition.audience === 'direct'
                                    ? 'Direct chats'
                                    : 'All chats'
                          } · ${definition.keywords.length ? definition.keywords.join(', ') : 'Every message'}`
                        : trigger.type === 'schedule'
                          ? `Every ${trigger.intervalMinutes || 60} minutes → ${trigger.chatId || 'Choose recipient'}`
                          : trigger.chatId || 'Choose recipient'}
                    </em>
                  </span>
                </button>
                {definition.steps.map((step, index) => {
                  const Icon = stepCatalog[step.type].icon;
                  return (
                    <div className="studio-node-group" key={step.id}>
                      <div className="studio-connector">
                        <ArrowDown size={16} />
                      </div>
                      <div className="studio-node-wrap">
                        <button
                          className={`studio-node studio-node-${step.type} ${selected === step.id ? 'selected' : ''}`}
                          onClick={() => setSelected(step.id)}
                        >
                          <span className="studio-node-icon">
                            <Icon size={20} />
                          </span>
                          <span>
                            <small>STEP {index + 1}</small>
                            <strong>{step.label}</strong>
                            <em>
                              {step.type === 'website'
                                ? `Read → ${step.config.output}`
                                : step.type === 'ai'
                                  ? `${step.config.task} → ${step.config.output}`
                                  : step.type === 'delay'
                                    ? `Wait ${step.config.seconds} seconds`
                                    : step.type === 'router'
                                      ? 'First matching path · configure destinations'
                                      : step.type === 'iterator'
                                        ? `For each ${step.config.alias} in ${step.config.array}`
                                        : step.type === 'aggregator'
                                          ? `Collect → ${step.config.output}`
                                          : step.type === 'reply'
                                            ? step.config.text
                                            : step.type === 'http'
                                              ? `${step.config.method} → ${step.config.output}`
                                              : step.type === 'variable'
                                                ? step.config.name
                                                : `${step.config.value} ${step.config.operator} ${step.config.expected}`}
                            </em>
                            {step.config.next && (
                              <em>
                                Then →{' '}
                                {step.config.next === 'end'
                                  ? 'Finish'
                                  : definition.steps.find(target => target.id === step.config.next)?.label ||
                                    'Missing step'}
                              </em>
                            )}
                          </span>
                        </button>
                        <div className="studio-node-controls">
                          <button
                            aria-label={`Move step ${index + 1} up`}
                            disabled={index === 0 || busy}
                            onClick={() => reorder(index, -1)}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            aria-label={`Move step ${index + 1} down`}
                            disabled={index === definition.steps.length - 1 || busy}
                            onClick={() => reorder(index, 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            aria-label={`Remove step ${index + 1}`}
                            disabled={busy}
                            onClick={() => {
                              edit({ steps: definition.steps.filter(item => item.id !== step.id) });
                              setSelected('trigger');
                            }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="studio-connector">
                  <ArrowDown size={16} />
                </div>
                <div className="studio-flow-end">
                  <CheckCircle2 size={14} /> End of workflow
                </div>
              </div>
              <div className="studio-footer">
                <span>{definition.steps.length}/20 steps</span>
                <button disabled={busy || !session} onClick={() => void perform('save')}>
                  <Save size={15} /> Save
                </button>
                <button className="studio-primary" disabled={busy || !session} onClick={() => void perform('publish')}>
                  {enabled ? 'Pause workflow' : 'Publish workflow'}
                </button>
              </div>
            </section>
            <aside className="studio-inspector">
              <div className="studio-section-title">
                <h3>{currentStep ? stepCatalog[currentStep.type].label : 'Trigger settings'}</h3>
              </div>
              <fieldset disabled={busy}>
                {!currentStep ? (
                  <>
                    <label className="studio-field">
                      Start when
                      <select
                        value={trigger.type}
                        onChange={e =>
                          edit({
                            trigger: {
                              type: e.target.value as NonNullable<StudioDefinition['trigger']>['type'],
                              chatId: trigger.chatId,
                              intervalMinutes: 60,
                            },
                          })
                        }
                      >
                        <option value="whatsapp">A WhatsApp message arrives</option>
                        <option value="webhook">A webhook arrives</option>
                        <option value="schedule">On a recurring schedule</option>
                      </select>
                    </label>
                    {trigger.type !== 'whatsapp' && (
                      <>
                        <label className="studio-field">
                          WhatsApp recipient ID
                          <input
                            value={trigger.chatId || ''}
                            placeholder="919876543210@c.us"
                            onChange={e => patchTrigger({ chatId: e.target.value.trim() })}
                          />
                        </label>
                        <p className="studio-muted">
                          Choose a consenting recipient. Direct chat: country code + number@c.us. Group: group ID@g.us.
                          Incoming payloads cannot change this destination.
                        </p>
                      </>
                    )}
                    {trigger.type === 'schedule' && (
                      <>
                        <label className="studio-field">
                          Repeat every (minutes)
                          <input
                            type="number"
                            min={1}
                            max={43200}
                            value={trigger.intervalMinutes || 60}
                            onChange={e => patchTrigger({ intervalMinutes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="studio-field">
                          First run (optional, UTC)
                          <input
                            placeholder="2026-09-16T09:00:00Z"
                            value={trigger.startAt || ''}
                            onChange={e => patchTrigger({ startAt: e.target.value || undefined })}
                          />
                        </label>
                        <p className="studio-muted">
                          Publishing starts the schedule. Pausing cancels pending runs. Missed intervals are combined
                          into one run after a restart.
                        </p>
                        {workflows.find(item => item.id === id)?.nextScheduleAt && (
                          <p className="studio-muted">
                            Next run:{' '}
                            {new Date(workflows.find(item => item.id === id)!.nextScheduleAt!).toLocaleString()}
                          </p>
                        )}
                      </>
                    )}
                    {trigger.type === 'webhook' && (
                      <>
                        <button type="button" onClick={() => void perform('token')}>
                          Save & generate new webhook token
                        </button>
                        <p className="studio-muted">
                          Publish before calling the webhook. Generating a token revokes the previous one. Tokens are
                          shown only once; store them securely.
                        </p>
                        {hookSecret && (
                          <>
                            <label className="studio-field">
                              Webhook URL
                              <input readOnly value={`${API_BASE_URL.replace(/\/api$/, '')}${hookSecret.path}`} />
                            </label>
                            <label className="studio-field">
                              {hookSecret.header}
                              <input readOnly value={hookSecret.token} onFocus={e => e.target.select()} />
                            </label>
                          </>
                        )}
                      </>
                    )}
                    {trigger.type === 'whatsapp' && (
                      <>
                        <label className="studio-field">
                          Keywords
                          <input
                            value={definition.keywords.join(', ')}
                            onChange={e => edit({ keywords: e.target.value.split(',').map(word => word.trim()) })}
                            placeholder="hello, order, price"
                          />
                        </label>
                        <p className="studio-muted">
                          Comma-separated keywords. Leave empty to match every incoming message.
                        </p>
                        <label className="studio-field">
                          Reply audience
                          <select
                            aria-label="Reply audience"
                            value={definition.audience}
                            onChange={e => edit({ audience: e.target.value as StudioDefinition['audience'] })}
                          >
                            <option value="direct">Direct chats</option>
                            <option value="specific_numbers">Specific phone numbers</option>
                            <option value="groups">WhatsApp groups (all)</option>
                            <option value="specific_groups">Specific WhatsApp groups</option>
                            <option value="all">All chats</option>
                          </select>
                        </label>
                        {definition.audience === 'specific_numbers' && (
                          <div className="studio-target-box">
                            <label className="studio-field">
                              Add from recent contacts
                              <select
                                aria-label="Select contact from active chats"
                                value=""
                                onChange={e => {
                                  const val = e.target.value;
                                  if (!val) return;
                                  const current = definition.targetChats || [];
                                  if (!current.includes(val)) {
                                    edit({ targetChats: [...current, val] });
                                  }
                                }}
                              >
                                <option value="">-- Choose active contact --</option>
                                {directChats.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.name || c.id} ({c.id.split('@')[0]})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="studio-field">
                              Or type phone number
                              <div className="studio-input-row">
                                <input
                                  aria-label="Enter specific phone number"
                                  placeholder="+91 98765 43210 or 919876543210"
                                  value={customTargetInput}
                                  onChange={e => setCustomTargetInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const trimmed = customTargetInput.trim();
                                      if (!trimmed) return;
                                      const current = definition.targetChats || [];
                                      if (!current.includes(trimmed)) {
                                        edit({ targetChats: [...current, trimmed] });
                                      }
                                      setCustomTargetInput('');
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="studio-btn-add-target"
                                  aria-label="Add phone number"
                                  onClick={() => {
                                    const trimmed = customTargetInput.trim();
                                    if (!trimmed) return;
                                    const current = definition.targetChats || [];
                                    if (!current.includes(trimmed)) {
                                      edit({ targetChats: [...current, trimmed] });
                                    }
                                    setCustomTargetInput('');
                                  }}
                                >
                                  <Plus size={14} /> Add
                                </button>
                              </div>
                            </label>
                            <div className="studio-target-chips">
                              {(definition.targetChats || []).map((target, idx) => (
                                <span key={idx} className="studio-target-chip">
                                  <Phone size={11} />
                                  <span>{sessionChats.find(c => c.id === target)?.name || target}</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove number ${target}`}
                                    onClick={() => {
                                      edit({ targetChats: (definition.targetChats || []).filter((_, i) => i !== idx) });
                                    }}
                                  >
                                    <X size={11} />
                                  </button>
                                </span>
                              ))}
                              {(!definition.targetChats || definition.targetChats.length === 0) && (
                                <small className="studio-hint-alert">
                                  No numbers added yet. Workflow will only trigger after at least one number is specified.
                                </small>
                              )}
                            </div>
                          </div>
                        )}
                        {definition.audience === 'specific_groups' && (
                          <div className="studio-target-box">
                            <label className="studio-field">
                              Choose WhatsApp group
                              <select
                                aria-label="Select WhatsApp group"
                                value=""
                                onChange={e => {
                                  const val = e.target.value;
                                  if (!val) return;
                                  const current = definition.targetChats || [];
                                  if (!current.includes(val)) {
                                    edit({ targetChats: [...current, val] });
                                  }
                                }}
                              >
                                <option value="">-- Choose active group --</option>
                                {groupChats.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.name || c.id}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="studio-field">
                              Or enter Group JID / ID
                              <div className="studio-input-row">
                                <input
                                  aria-label="Enter specific group ID"
                                  placeholder="120363024829392@g.us"
                                  value={customTargetInput}
                                  onChange={e => setCustomTargetInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const trimmed = customTargetInput.trim();
                                      if (!trimmed) return;
                                      const current = definition.targetChats || [];
                                      if (!current.includes(trimmed)) {
                                        edit({ targetChats: [...current, trimmed] });
                                      }
                                      setCustomTargetInput('');
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="studio-btn-add-target"
                                  aria-label="Add group ID"
                                  onClick={() => {
                                    const trimmed = customTargetInput.trim();
                                    if (!trimmed) return;
                                    const current = definition.targetChats || [];
                                    if (!current.includes(trimmed)) {
                                      edit({ targetChats: [...current, trimmed] });
                                    }
                                    setCustomTargetInput('');
                                  }}
                                >
                                  <Plus size={14} /> Add
                                </button>
                              </div>
                            </label>
                            <div className="studio-target-chips">
                              {(definition.targetChats || []).map((target, idx) => (
                                <span key={idx} className="studio-target-chip">
                                  <Users size={11} />
                                  <span>{sessionChats.find(c => c.id === target)?.name || target}</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove group ${target}`}
                                    onClick={() => {
                                      edit({ targetChats: (definition.targetChats || []).filter((_, i) => i !== idx) });
                                    }}
                                  >
                                    <X size={11} />
                                  </button>
                                </span>
                              ))}
                              {(!definition.targetChats || definition.targetChats.length === 0) && (
                                <small className="studio-hint-alert">
                                  No groups added yet. Workflow will only trigger after at least one group is specified.
                                </small>
                              )}
                            </div>
                          </div>
                        )}
                        <label className="studio-field">
                          Cooldown (seconds)
                          <input
                            type="number"
                            min={10}
                            max={86400}
                            value={definition.cooldownSeconds}
                            onChange={e => edit({ cooldownSeconds: Number(e.target.value) })}
                          />
                        </label>
                        <p className="studio-muted">
                          One matching workflow handles each message, in creation order. Published Studio workflows run
                          before chatbot and lead flows.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <label className="studio-field">
                      Step label
                      <input
                        value={currentStep.label}
                        onChange={e =>
                          edit({
                            steps: definition.steps.map(step =>
                              step.id === selected ? { ...step, label: e.target.value } : step,
                            ),
                          })
                        }
                      />
                    </label>
                    {currentStep.type === 'variable' && (
                      <>
                        {field('Variable name', 'name', 'customer')}
                        {field('Value', 'value', '{{message}}', true)}
                      </>
                    )}
                    {currentStep.type === 'filter' && (
                      <>
                        {field('Value to check', 'value', '{{api.completed}}')}
                        <label className="studio-field">
                          Condition
                          <select
                            value={currentStep.config.operator}
                            onChange={e => patchStep({ operator: e.target.value })}
                          >
                            <option value="contains">Contains</option>
                            <option value="equals">Equals</option>
                            <option value="not_equals">Does not equal</option>
                            <option value="not_empty">Is not empty</option>
                            <option value="greater">Greater than</option>
                          </select>
                        </label>
                        {currentStep.config.operator !== 'not_empty' &&
                          field('Compare with', 'expected', 'Expected value')}
                      </>
                    )}
                    {currentStep.type === 'http' && (
                      <>
                        <label className="studio-field">
                          Connection
                          <select
                            value={currentStep.config.connectionId || ''}
                            onChange={e => patchStep({ connectionId: e.target.value, method: 'GET' })}
                          >
                            <option value="">Public endpoint</option>
                            {connections
                              .filter(connection => connection.kind === 'api')
                              .map(connection => (
                                <option key={connection.id} value={connection.id} disabled={!connection.enabled}>
                                  {connection.name}
                                  {connection.enabled ? '' : ' (disabled)'}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="studio-field">
                          Method
                          <select
                            value={currentStep.config.method}
                            onChange={e => patchStep({ method: e.target.value })}
                          >
                            <option>GET</option>
                            {!currentStep.config.connectionId && <option>POST</option>}
                          </select>
                        </label>
                        {currentStep.config.connectionId
                          ? field('Relative API path', 'path', 'customers/123')
                          : field('HTTPS endpoint', 'url', 'https://example.com/api')}
                        {currentStep.config.method === 'POST' && field('JSON request body', 'body', '{}', true)}
                        {field('Save response as', 'output', 'api')}
                        {field('Retries after failure (0–3)', 'retries', '0')}
                        {field('Initial retry wait (seconds, 1–60)', 'backoffSeconds', '5')}
                        <p className="studio-muted">
                          HTTPS endpoints. Up to 3 requests, 10 seconds each, 256 KB response. Connected APIs support
                          GET only. Manage credentials in Connections; approved CFL MCP connections support OAuth.
                        </p>
                      </>
                    )}
                    {currentStep.type === 'mcp' && (
                      <>
                        <label className="studio-field">
                          MCP connection
                          <select
                            value={currentStep.config.connectionId || ''}
                            onChange={e => patchStep({ connectionId: e.target.value, tool: '' })}
                          >
                            <option value="">Select connection</option>
                            {connections
                              .filter(connection => connection.kind === 'mcp')
                              .map(connection => (
                                <option key={connection.id} value={connection.id} disabled={!connection.enabled}>
                                  {connection.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="studio-field">
                          Approved tool
                          <select
                            value={currentStep.config.tool || ''}
                            onChange={e => patchStep({ tool: e.target.value })}
                          >
                            <option value="">Select approved tool</option>
                            {(
                              connections.find(connection => connection.id === currentStep.config.connectionId)
                                ?.allowedTools || []
                            ).map(tool => (
                              <option key={tool}>{tool}</option>
                            ))}
                          </select>
                        </label>
                        {field('JSON arguments', 'arguments', '{"query":"{{message}}"}', true)}
                        {field('Save result as', 'output', 'toolResult')}
                        <p className="studio-muted">
                          Use {'{{toolResult.text}}'} in a reply or AI source. Tests invoke the approved read-only tool
                          but never send WhatsApp. JSON Streamable HTTP only; no write tools, shell, subscriptions or
                          OAuth.
                        </p>
                      </>
                    )}
                    {currentStep.type === 'website' && (
                      <>
                        {field('Website URL', 'url', 'https://example.com')}
                        {field('Save website data as', 'output', 'site')}
                        <label className="studio-field">
                          Read region
                          <select
                            value={currentStep.config.mode || 'auto'}
                            onChange={e => patchStep({ mode: e.target.value })}
                          >
                            <option value="auto">Auto (article, main, then body)</option>
                            <option value="article">Article only</option>
                            <option value="main">Main only</option>
                            <option value="body">Whole page text</option>
                          </select>
                        </label>
                        {field('Maximum text characters (500–24000)', 'maxChars', '20000')}
                        <p className="studio-muted">
                          Use websites you are allowed to access. HTML/plain text only; no login, PDF, JavaScript
                          rendering, redirects or crawling. Scripts, forms and common navigation are omitted. Map{' '}
                          {'{{site.text}}'}, {'{{site.title}}'}, {'{{site.url}}'}, {'{{site.links}}'} or{' '}
                          {'{{site.truncated}}'}.
                        </p>
                      </>
                    )}
                    {currentStep.type === 'ai' && (
                      <>
                        <label className="studio-field">
                          AI task
                          <select value={currentStep.config.task} onChange={e => patchStep({ task: e.target.value })}>
                            <option value="summarize">Summarize source</option>
                            <option value="answer">Answer from source</option>
                            <option value="extract">Extract structured fields</option>
                            <option value="translate">Translate source</option>
                          </select>
                        </label>
                        {field('Source data', 'input', '{{site.text}}', true)}
                        {currentStep.config.task === 'answer' &&
                          field('Customer question', 'question', '{{message}}', true)}
                        {currentStep.config.task === 'extract' &&
                          field('Fields to extract (comma-separated)', 'fields', 'name, price, timing')}
                        {field(
                          'Instructions (static text, no variables)',
                          'instructions',
                          'Keep replies short and factual.',
                          true,
                        )}
                        <label className="studio-field">
                          Output language
                          <select
                            value={currentStep.config.language || 'auto'}
                            onChange={e => patchStep({ language: e.target.value })}
                          >
                            <option value="auto">Customer language</option>
                            <option>Gujarati</option>
                            <option>Hindi</option>
                            <option>English</option>
                          </select>
                        </label>
                        {field('Save AI result as', 'output', 'answer')}
                        <p className="studio-muted">
                          Uses this session's credentials and model from <a href="/ai-chatbot">AI Chatbot</a>, even when
                          its fallback bot is disabled. Source data and the question are sent to that provider; tests
                          use real AI and may incur charges. No tools or autonomous actions. Review results before
                          publishing.
                        </p>
                      </>
                    )}
                    {currentStep.type === 'router' && (
                      <StudioRouterEditor step={currentStep} targets={laterSteps} onChange={patchStep} />
                    )}
                    {currentStep.type === 'delay' && (
                      <>
                        {field('Wait (seconds, 1–604800)', 'seconds', '60')}
                        <p className="studio-muted">
                          The run is saved in the database and resumes after the wait, even after a server restart.
                          Tests simulate waits.
                        </p>
                      </>
                    )}
                    {currentStep.type === 'iterator' && (
                      <>
                        {field('List (variable or JSON array)', 'array', '{{api.items}}', true)}
                        {field('Current item variable', 'alias', 'item')}
                        <label className="studio-field">
                          Collect at
                          <select
                            value={currentStep.config.end || ''}
                            onChange={e => patchStep({ end: e.target.value })}
                          >
                            <option value="">Choose an aggregator</option>
                            {laterSteps
                              .filter(step => step.type === 'aggregator')
                              .map(step => (
                                <option key={step.id} value={step.id}>
                                  {step.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <p className="studio-muted">
                          Move processing steps between this iterator and its aggregator. Up to 100 items; use{' '}
                          {'{{item.field}}'} and zero-based {'{{index}}'} inside the loop.
                        </p>
                      </>
                    )}
                    {currentStep.type === 'aggregator' && (
                      <>
                        {field('Collect value from each item', 'value', '{{item.title}}', true)}
                        {field('Save combined result as', 'output', 'summary')}
                        <label className="studio-field">
                          Combine as
                          <select
                            value={currentStep.config.format || 'text'}
                            onChange={e => patchStep({ format: e.target.value })}
                          >
                            <option value="text">Text</option>
                            <option value="json">JSON array</option>
                          </select>
                        </label>
                        {currentStep.config.format !== 'json' && field('Separator', 'separator', 'Line break', true)}
                      </>
                    )}
                    {currentStep.type === 'reply' && (
                      <>
                        {field('Reply message', 'text', 'Your order: {{api.title}}', true)}
                        <p className="studio-muted">
                          Use variables to personalize the message. Missing mappings stop the run so customers receive
                          no broken placeholders.
                        </p>
                      </>
                    )}
                    {currentStep.type !== 'router' && currentStep.type !== 'iterator' && (
                      <label className="studio-field">
                        Then go to
                        <select
                          value={currentStep.config.next || ''}
                          onChange={e => patchStep({ next: e.target.value })}
                        >
                          <option value="">Next step in order</option>
                          <option value="end">Finish workflow</option>
                          {laterSteps.map(step => (
                            <option key={step.id} value={step.id}>
                              {step.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="studio-field">
                      If this step fails
                      <select
                        value={currentStep.config.onError || 'stop'}
                        onChange={e => patchStep({ onError: e.target.value })}
                      >
                        <option value="stop">Stop and log the error</option>
                        <option value="continue">Continue to next step</option>
                        <option value="route">Go to an error handler</option>
                      </select>
                    </label>
                    {currentStep.config.onError === 'route' && (
                      <label className="studio-field">
                        Error handler
                        <select
                          value={currentStep.config.errorTarget || ''}
                          onChange={e => patchStep({ errorTarget: e.target.value })}
                        >
                          <option value="">Choose a later step</option>
                          <option value="end">Finish workflow</option>
                          {laterSteps.map(step => (
                            <option key={step.id} value={step.id}>
                              {step.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </fieldset>
              <div className="studio-mapping">
                <strong>Available variables</strong>
                <code>{'{{message}}'}</code>
                <code>{'{{chatId}}'}</code>
                <code>{'{{now}}'}</code>
                <code>{'{{error}} · after a handled failure'}</code>
                {trigger.type === 'webhook' && <code>{'{{webhook.name}} · incoming payload fields'}</code>}
                {definition.steps
                  .slice(0, currentStep ? definition.steps.indexOf(currentStep) : 0)
                  .filter(
                    step =>
                      ['http', 'variable', 'iterator', 'aggregator', 'website', 'ai'].includes(step.type) &&
                      (step.type !== 'iterator' ||
                        (currentStep &&
                          definition.steps.indexOf(currentStep) <=
                            definition.steps.findIndex(end => end.id === step.config.end))),
                  )
                  .map(step => (
                    <code
                      key={step.id}
                    >{`{{${step.config.output || step.config.name || step.config.alias}}}${['http', 'iterator', 'website'].includes(step.type) || (step.type === 'ai' && step.config.task === 'extract') ? ' · use .field for nested data' : ''}`}</code>
                  ))}
              </div>
            </aside>
          </div>
          <section className="studio-test">
            <div>
              <h3>Test your workflow</h3>
              <p>
                Real website, API and AI calls (provider charges may apply), simulated delays and retries. WhatsApp
                replies are previewed, not sent. External API writes may still have side effects.
              </p>
            </div>
            <div className="studio-test-controls">
              {trigger.type === 'webhook' && (
                <textarea
                  aria-label="Webhook test payload"
                  value={hookSample}
                  onChange={e => setHookSample(e.target.value)}
                  disabled={busy}
                />
              )}
              <input
                aria-label="Test customer message"
                placeholder="Type a customer message…"
                value={message}
                disabled={busy}
                onChange={e => setMessage(e.target.value)}
              />
              <button
                className="studio-primary"
                disabled={busy || !session || (trigger.type === 'whatsapp' && !message.trim())}
                onClick={() => void perform('test')}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Save & test
              </button>
            </div>
            {result && <Trace execution={result} />}
          </section>
        </>
      )}
    </div>
  );
}
function Trace({ execution }: { execution: StudioExecution }) {
  return (
    <div className="studio-trace">
      <div className="studio-trace-summary">
        <span className={`studio-status ${execution.status}`}>{execution.status}</span>
        <span>{execution.durationMs} ms</span>
      </div>
      {execution.trace.map((step, index) => (
        <div className="studio-trace-step" key={`${step.stepId}-${index}`}>
          <span className={`studio-status ${step.status}`}>{step.status}</span>
          <strong>{step.label}</strong>
          <small>{step.durationMs} ms</small>
          <pre>{step.output}</pre>
        </div>
      ))}
    </div>
  );
}

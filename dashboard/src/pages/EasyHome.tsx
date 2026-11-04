import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Calendar,
  MessageSquare,
  Smartphone,
  ArrowUpRight,
  Pause,
  ChevronRight,
  CheckCheck,
  Clock,
  Workflow,
  Users,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useSessionsQuery } from '../hooks/queries';
import { contactApi, scheduledMessageApi, statsApi, studioApi, type StudioWorkflow } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import './EasyHome.css';

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="easy-skeleton-list" aria-busy="true">
      <span className="easy-sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="easy-skeleton-row" key={i}>
          <span className="easy-skel easy-skel-icon" />
          <span className="easy-skel-lines">
            <span className="easy-skel easy-skel-line" />
            <span className="easy-skel easy-skel-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}

const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

export function EasyHome() {
  useDocumentTitle('Home');
  const client = useQueryClient();
  const { canWrite, user } = useRole();
  const accounts = useSessionsQuery();
  const [selected, setSelected] = useState('');
  const account =
    accounts.data?.find(a => a.id === selected) ?? accounts.data?.find(a => a.status === 'ready') ?? accounts.data?.[0];
  const destination = (path: string) =>
    account && ['/message-tester', '/automations'].some(prefix => path.startsWith(prefix))
      ? `${path}${path.includes('?') ? '&' : '?'}session=${encodeURIComponent(account.id)}`
      : path;
  const schedules = useQuery({
    queryKey: ['easy-home', 'schedules'],
    queryFn: () => scheduledMessageApi.listAll(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const workflows = useQuery({
    queryKey: ['studio', 'workflows', account?.id],
    queryFn: () => studioApi.list(account!.id),
    enabled: !!account,
    staleTime: 30_000,
  });
  const overview = useQuery({
    queryKey: ['easy-home', 'overview'],
    queryFn: () => statsApi.getOverview(),
    staleTime: 60_000,
    retry: false,
  });
  const contactsEnabled = !!account && account.status === 'ready';
  const contacts = useQuery({
    queryKey: ['easy-home', 'contacts', account?.id],
    queryFn: () => contactApi.list(account!.id),
    enabled: contactsEnabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pause = useMutation({
    mutationFn: (flow: StudioWorkflow) =>
      studioApi.save(flow.sessionId, { name: flow.name, definition: flow.definition, enabled: false }, flow.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['studio', 'workflows'] }),
  });
  const upcoming = (schedules.data ?? [])
    .filter(s => s.status === 'pending' && s.sessionId === account?.id)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const failed = (schedules.data ?? []).filter(s => s.sessionId === account?.id && s.status === 'failed');
  const overdue = upcoming.filter(s => Date.parse(s.scheduledAt) < Date.now() - 60_000);
  const unavailable = !!account && account.status !== 'ready';
  const noAccounts = accounts.isSuccess && !accounts.data?.length;
  const active = (workflows.data ?? []).filter(w => w.enabled);
  const firstName = user?.name?.replace(/^user:/i, '').split(/[\s._-]/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const kpis = [
    {
      label: 'Messages sent today',
      loading: overview.isPending,
      value: overview.data?.messages.today.sent,
      sub: overview.data
        ? `${fmt(overview.data.messages.sent)} sent all time`
        : overview.isError
          ? 'Not available'
          : ' ',
      icon: CheckCheck,
      tone: 'green',
      to: '/analytics',
    },
    {
      label: 'Scheduled',
      loading: schedules.isPending,
      value: schedules.isError ? undefined : upcoming.length,
      sub: overdue.length ? `${overdue.length} overdue` : failed.length ? `${failed.length} failed` : 'Waiting to send',
      icon: Clock,
      tone: 'blue',
      to: `${destination('/message-tester?status=pending')}#message-schedules`,
    },
    {
      label: 'Active automations',
      loading: !!account && workflows.isPending,
      value: !account ? 0 : workflows.isError ? undefined : active.length,
      sub: `${workflows.data?.length ?? 0} workflows in total`,
      icon: Workflow,
      tone: 'violet',
      to: destination('/automations'),
    },
    {
      label: 'Contacts',
      loading: contactsEnabled && contacts.isPending,
      value: contactsEnabled ? contacts.data?.length : undefined,
      sub: !contactsEnabled ? 'Connect WhatsApp to load' : contacts.isError ? 'Not available' : 'On this account',
      icon: Users,
      tone: 'amber',
      to: '/group-contacts',
    },
  ];

  const actions = [
    { title: 'Send a message', text: 'Start a conversation now.', icon: Send, to: '/message-tester', tone: 'green' },
    {
      title: 'Schedule a message',
      text: 'Pick a time. We’ll send it.',
      icon: Calendar,
      to: '/message-tester?mode=schedule',
      tone: 'blue',
    },
    {
      title: 'Manage auto-replies',
      text: 'Reply automatically, your way.',
      icon: MessageSquare,
      to: '/automations',
      tone: 'violet',
    },
    { title: 'Connect WhatsApp', text: 'Add or reconnect a number.', icon: Smartphone, to: '/sessions', tone: 'amber' },
  ];
  return (
    <div className="easy-home">
      <header className="easy-hero">
        <div>
          <p className="easy-eyebrow">Overview</p>
          <h1>
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="easy-sub">Here’s what’s happening in your WhatsApp workspace.</p>
        </div>
        <label className="easy-account-select">
          WhatsApp account
          <select
            value={account?.id ?? ''}
            onChange={e => {
              setSelected(e.target.value);
              pause.reset();
            }}
            disabled={!accounts.data?.length}
          >
            {!accounts.data?.length && <option value="">No accounts</option>}
            {accounts.data?.map(a => (
              <option value={a.id} key={a.id}>
                {a.name || a.id} · {a.status === 'ready' ? 'Connected' : a.status}
              </option>
            ))}
          </select>
        </label>
      </header>

      {accounts.isError && (
        <div className="easy-alert error" role="alert">
          <AlertTriangle size={18} />
          <span>Could not load your WhatsApp accounts.</span>
          <button className="easy-btn" onClick={() => accounts.refetch()}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {(noAccounts || unavailable || (!schedules.isError && (failed.length > 0 || overdue.length > 0))) && (
        <section className="easy-attention" aria-label="Needs attention">
          <div className="easy-attention-head">
            <AlertTriangle size={18} />
            <h2>Needs attention</h2>
          </div>
          {(noAccounts || unavailable) && (
            <div className="easy-attention-item">
              <span>
                <strong>{noAccounts ? 'No WhatsApp number connected yet' : 'WhatsApp is not connected'}</strong>
                <small>
                  {noAccounts
                    ? 'Scan a QR code to start sending messages.'
                    : `${account?.name || 'This account'} is ${account?.status}. Scheduled messages will wait until it reconnects.`}
                </small>
              </span>
              <Link className="easy-btn primary" to="/sessions">
                {noAccounts ? 'Connect WhatsApp' : 'Reconnect now'}
              </Link>
            </div>
          )}
          {!schedules.isError && failed.length > 0 && (
            <div className="easy-attention-item">
              <span>
                <strong>
                  {failed.length} failed {failed.length === 1 ? 'message' : 'messages'}
                </strong>
                <small>Review the error before retrying.</small>
              </span>
              <Link className="easy-btn" to={`${destination('/message-tester?status=failed')}#message-schedules`}>
                Review failed messages →
              </Link>
            </div>
          )}
          {!schedules.isError && overdue.length > 0 && (
            <div className="easy-attention-item">
              <span>
                <strong>
                  {overdue.length} {overdue.length === 1 ? 'message is' : 'messages are'} overdue
                </strong>
                <small>Still pending more than a minute after the selected time.</small>
              </span>
              <Link className="easy-btn" to={`${destination('/message-tester?status=pending')}#message-schedules`}>
                Review pending messages →
              </Link>
            </div>
          )}
        </section>
      )}

      <section className="easy-kpis" aria-label="Summary">
        {kpis.map(({ label, loading, value, sub, icon: Icon, tone, to }) => (
          <Link to={to} className={`easy-kpi tone-${tone}`} key={label}>
            <span className="easy-kpi-top">
              <span className="easy-kpi-label">{label}</span>
              <span className="easy-kpi-icon">
                <Icon size={16} />
              </span>
            </span>
            {loading ? (
              <span className="easy-skel easy-skel-number" />
            ) : (
              <span className="easy-kpi-value">{fmt(value)}</span>
            )}
            <span className="easy-kpi-sub">{sub}</span>
          </Link>
        ))}
      </section>

      <h2 className="easy-section-title">Quick actions</h2>
      <div className="easy-actions">
        {actions.map(({ title, text, icon: Icon, to, tone }) => (
          <Link to={destination(to)} key={title} className={`easy-action tone-${tone}`}>
            <span className="easy-icon">
              <Icon size={20} />
            </span>
            <span className="easy-action-text">
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
            <ArrowUpRight className="easy-arrow" size={18} />
          </Link>
        ))}
      </div>

      <div className="easy-panels">
        <section className="easy-panel">
          <div className="easy-panel-heading">
            <div>
              <h2>Upcoming messages</h2>
              <p className="easy-caption">
                {account?.name || 'Your account'} · Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
            </div>
            <Link className="easy-link" to={destination('/message-tester')}>
              View all <ChevronRight size={16} />
            </Link>
          </div>
          {schedules.isPending || accounts.isPending ? (
            <SkeletonRows />
          ) : schedules.isError ? (
            <div className="easy-empty" role="alert">
              <span className="easy-empty-icon error">
                <AlertTriangle size={22} />
              </span>
              <h3>Messages could not be loaded</h3>
              <button className="easy-btn" onClick={() => schedules.refetch()}>
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          ) : !upcoming.length ? (
            <div className="easy-empty">
              <span className="easy-empty-icon">
                <Calendar size={22} />
              </span>
              <h3>Nothing scheduled</h3>
              <p>Schedule a reminder or update and it will show up here.</p>
              <Link className="easy-btn primary" to={destination('/message-tester?mode=schedule')}>
                Schedule a message
              </Link>
            </div>
          ) : (
            <ul className="easy-list">
              {upcoming.slice(0, 5).map(item => {
                const late = Date.parse(item.scheduledAt) < Date.now();
                return (
                  <li key={item.id}>
                    <Link className="easy-message" to={destination('/message-tester')}>
                      <span className="easy-message-icon">
                        <MessageSquare size={16} />
                      </span>
                      <span className="easy-message-body">
                        <strong>{item.previewText || `${item.messageType} message`}</strong>
                        <small>{item.recipient}</small>
                      </span>
                      <span className="easy-message-meta">
                        <time dateTime={item.scheduledAt}>
                          {new Date(item.scheduledAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </time>
                        <span className={`easy-status ${late ? 'warn' : ''}`}>
                          {late ? 'Awaiting send' : 'Scheduled'}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="easy-panel">
          <div className="easy-panel-heading">
            <div>
              <h2>Active automations</h2>
              <p className="easy-caption">
                Studio workflows. <Link to="/ai-chatbot">AI replies</Link> are managed separately.
              </p>
            </div>
            <Link className="easy-link" to={destination('/automations')}>
              Manage <ChevronRight size={16} />
            </Link>
          </div>
          {pause.isError && (
            <p className="easy-alert error" role="alert">
              Could not pause this automation. Please try again.
            </p>
          )}
          {pause.isSuccess && (
            <p className="easy-alert ok" role="status">
              Automation paused. It will not start new replies.
            </p>
          )}
          {!account ? (
            <div className="easy-empty">
              <span className="easy-empty-icon">
                <Smartphone size={22} />
              </span>
              <h3>Connect an account first</h3>
              <p>Automations run on a connected WhatsApp number.</p>
              <Link className="easy-btn primary" to="/sessions">
                Connect WhatsApp
              </Link>
            </div>
          ) : workflows.isPending ? (
            <SkeletonRows count={2} />
          ) : workflows.isError ? (
            <div className="easy-empty" role="alert">
              <span className="easy-empty-icon error">
                <AlertTriangle size={22} />
              </span>
              <h3>Could not load automations</h3>
              <button className="easy-btn" onClick={() => workflows.refetch()}>
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          ) : !active.length ? (
            <div className="easy-empty">
              <span className="easy-empty-icon">
                <Workflow size={22} />
              </span>
              <h3>No automations running</h3>
              <p>Set up auto-replies so customers get answers even when you’re away.</p>
              <Link className="easy-btn primary" to={destination('/automations')}>
                Create an automation
              </Link>
            </div>
          ) : (
            <ul className="easy-list">
              {active.map(flow => (
                <li className="easy-flow" key={flow.id}>
                  <span className="easy-message-icon">
                    <Workflow size={16} />
                  </span>
                  <span className="easy-message-body">
                    <strong>{flow.name}</strong>
                    <small>
                      <span className="easy-dot" /> Running
                    </small>
                  </span>
                  <button
                    className="easy-btn"
                    disabled={pause.isPending || !canWrite}
                    onClick={() => pause.mutate(flow)}
                    aria-label={`Pause ${flow.name}`}
                  >
                    <Pause size={14} /> Pause
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <footer className="easy-footer">
        <Link to="/chats">Open inbox →</Link>
        <Link to="/analytics">Detailed reports →</Link>
      </footer>
    </div>
  );
}

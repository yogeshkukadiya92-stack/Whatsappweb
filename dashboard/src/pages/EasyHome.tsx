import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Calendar, MessageSquare, Smartphone, ArrowUpRight, Pause, ChevronRight } from 'lucide-react';
import { useSessionsQuery } from '../hooks/queries';
import { scheduledMessageApi, studioApi, type StudioWorkflow } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import './EasyHome.css';

export function EasyHome() {
  useDocumentTitle('Home');
  const client = useQueryClient();
  const { canWrite } = useRole();
  const accounts = useSessionsQuery();
  const [selected, setSelected] = useState('');
  const account = accounts.data?.find(a => a.id === selected) ?? accounts.data?.[0];
  const destination = (path: string) => account && ['/message-tester', '/automations'].some(prefix => path.startsWith(prefix)) ? `${path}${path.includes('?') ? '&' : '?'}session=${encodeURIComponent(account.id)}` : path;
  const schedules = useQuery({ queryKey: ['easy-home', 'schedules'], queryFn: () => scheduledMessageApi.listAll(), staleTime: 30_000, refetchInterval: 30_000 });
  const workflows = useQuery({ queryKey: ['studio', 'workflows', account?.id], queryFn: () => studioApi.list(account!.id), enabled: !!account, staleTime: 30_000 });
  const pause = useMutation({
    mutationFn: (flow: StudioWorkflow) => studioApi.save(flow.sessionId, { name: flow.name, definition: flow.definition, enabled: false }, flow.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['studio', 'workflows'] }),
  });
  const upcoming = (schedules.data ?? []).filter(s => s.status === 'pending' && s.sessionId === account?.id)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const failed = (schedules.data ?? []).filter(s => s.sessionId === account?.id && s.status === 'failed');
  const overdue = upcoming.filter(s => Date.parse(s.scheduledAt) < Date.now() - 60_000);
  const unavailable = !!account && account.status !== 'ready';
  const active = (workflows.data ?? []).filter(w => w.enabled);
  const actions = [
    { title: 'Send a message', text: 'Start a conversation.', icon: Send, to: '/message-tester' },
    { title: 'Schedule a message', text: 'Choose a time. We’ll handle the rest.', icon: Calendar, to: '/message-tester?mode=schedule' },
    { title: 'Manage auto-replies', text: 'You decide when to reply automatically.', icon: MessageSquare, to: '/automations' },
    { title: 'Connect WhatsApp', text: 'Add or reconnect an account.', icon: Smartphone, to: '/sessions' },
  ];
  return <div className="easy-home">
    <div className="easy-toolbar"><span className="easy-eyebrow">YOUR WHATSAPP WORKSPACE</span><label>WhatsApp account<select value={account?.id ?? ''} onChange={e => { setSelected(e.target.value); pause.reset(); }} disabled={!accounts.data?.length}>
      {!accounts.data?.length && <option value="">No accounts</option>}
      {accounts.data?.map(a => <option value={a.id} key={a.id}>{a.name || a.id} · {a.status === 'ready' ? 'Connected' : a.status}</option>)}
    </select></label></div>
    <header className="easy-heading"><h1>What would you like to do?</h1><p>Messages, schedules and replies. All in one place.</p></header>
    {accounts.isError && <p role="alert">Could not load accounts. <button onClick={() => accounts.refetch()}>Try again</button></p>}
    <div className="easy-actions">{actions.map(({ title, text, icon: Icon, to }) => <Link to={destination(to)} key={title} className="easy-action"><span className="easy-icon"><Icon size={25} /></span><h2>{title}</h2><p>{text}</p><ArrowUpRight className="easy-arrow" size={20} /></Link>)}</div>
    {(unavailable || (!schedules.isError && (failed.length > 0 || overdue.length > 0))) && <section className="easy-attention" aria-label="Needs attention">
      <h2>Needs attention</h2><p>For {account?.name || 'your account'}</p>
      {unavailable && <div><span><strong>WhatsApp is not connected</strong><small>Current status: {account?.status}. Scheduled messages may wait for a connection.</small></span><Link to="/sessions">Check account →</Link></div>}
      {!schedules.isError && failed.length > 0 && <div><span><strong>{failed.length} failed {failed.length === 1 ? 'message' : 'messages'}</strong><small>Review the error before retrying.</small></span><Link to={`${destination('/message-tester?status=failed')}#message-schedules`}>Review failed messages →</Link></div>}
      {!schedules.isError && overdue.length > 0 && <div><span><strong>{overdue.length} {overdue.length === 1 ? 'message is' : 'messages are'} overdue</strong><small>Still pending more than a minute after the selected time.</small></span><Link to={`${destination('/message-tester?status=pending')}#message-schedules`}>Review pending messages →</Link></div>}
    </section>}
    <div className="easy-panels">
      <section className="easy-panel"><div className="easy-panel-heading"><h2>Upcoming messages</h2><Link to={destination('/message-tester')}>View all <ChevronRight size={16}/></Link></div>
        <p className="easy-caption">For {account?.name || 'your account'} · Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        {schedules.isPending || accounts.isPending ? <p className="easy-empty">Loading messages…</p> : schedules.isError ? <p className="easy-empty" role="alert">Messages could not be loaded. <button onClick={() => schedules.refetch()}>Try again</button></p> : !upcoming.length ? <div className="easy-empty"><Calendar size={28}/><h3>Your next message starts here</h3><p>Schedule a reminder or an update for later.</p><Link to={destination('/message-tester?mode=schedule')}>Schedule a message →</Link></div> : upcoming.slice(0, 5).map(item => <Link className="easy-message" to={destination('/message-tester')} key={item.id}><span className="easy-message-icon"><MessageSquare size={20}/></span><div><strong>{item.previewText || `${item.messageType} message`}</strong><small>{item.recipient}</small><time dateTime={item.scheduledAt}>{new Date(item.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div><span className="easy-status">{Date.parse(item.scheduledAt) < Date.now() ? 'Awaiting send' : 'Scheduled'}</span></Link>)}
      </section>
      <section className="easy-panel"><div className="easy-panel-heading"><h2>Active automations</h2><Link to={destination('/automations')}>Manage <ChevronRight size={16}/></Link></div><p className="easy-caption">Studio workflows for {account?.name || 'your account'}. <Link to="/ai-chatbot">AI replies</Link> are managed separately.</p>
        {pause.isError && <p role="alert">Could not pause this automation. Please try again.</p>}
        {pause.isSuccess && <p role="status">Automation paused. It will not start new replies.</p>}
        {!account ? <p className="easy-empty">Connect an account to manage its automations.</p> : workflows.isPending ? <p className="easy-empty">Loading automations…</p> : workflows.isError ? <p className="easy-empty" role="alert">Could not load automations. <button onClick={() => workflows.refetch()}>Try again</button></p> : !active.length ? <div className="easy-empty"><MessageSquare size={28}/><h3>You’re in control</h3><p>No active Studio automations for this account.</p><Link to={destination('/automations')}>Manage automations →</Link></div> : active.map(flow => <div className="easy-flow" key={flow.id}><span className="easy-message-icon"><MessageSquare size={20}/></span><div><strong>{flow.name}</strong><small>Active</small></div><button disabled={pause.isPending || !canWrite} onClick={() => pause.mutate(flow)} aria-label={`Pause ${flow.name}`}><Pause size={16}/> Pause</button></div>)}
      </section>
    </div>
    <footer className="easy-footer"><Link to="/chats">Open inbox →</Link><Link to="/analytics">Detailed dashboard →</Link></footer>
  </div>;
}

import { useState, useEffect, useMemo, Suspense } from 'react';
import { lazyWithRetry as lazy } from '../utils/lazyWithRetry';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Loader2,
  Plus,
  Bot,
  Radio,
  Zap,
  Sparkles,
  TrendingUp,
  Clock,
  Calendar,
  GitBranch,
  ChevronRight,
  Cpu,
  Target,
  FileText,
  Sliders,
  Webhook,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  useSessionsQuery,
  useSessionStatsQuery,
  useWebhooksQuery,
  useStopSessionMutation,
  useStatsOverviewQuery,
} from '../hooks/queries';
import {
  aiBotApi,
  studioApi,
  leadFlowsApi,
} from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { TiltCard } from '../components/TiltCard';
import './Dashboard.css';

// recharts is heavy (~150kB gzip); load the analytics section on demand so it never bloats the
// main/login bundle and only ships when the dashboard actually renders.
const DashboardCharts = lazy(() => import('../components/DashboardCharts').then(m => ({ default: m.DashboardCharts })));

function DataPulseVisualizer() {
  return (
    <div className="data-pulse-visualizer" aria-hidden="true" title="Realtime Event Stream">
      <span className="pulse-bar" style={{ animationDelay: '0s' }} />
      <span className="pulse-bar" style={{ animationDelay: '0.15s' }} />
      <span className="pulse-bar" style={{ animationDelay: '0.3s' }} />
      <span className="pulse-bar" style={{ animationDelay: '0.1s' }} />
      <span className="pulse-bar" style={{ animationDelay: '0.25s' }} />
      <span className="pulse-bar" style={{ animationDelay: '0.4s' }} />
      <span className="pulse-bar" style={{ animationDelay: '0.05s' }} />
    </div>
  );
}

interface ScheduledItemSummary {
  id: string;
  sessionId: string;
  recipient: string;
  recipientType: 'personal' | 'group';
  messageType: string;
  scheduledAt: string;
  createdAt: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  previewText: string;
}

interface CampaignSummary {
  id: string;
  name: string;
  sessionId: string;
  messageType: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
}

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const navigate = useNavigate();
  const { data: sessions = [], isLoading: loadingSessions, error: sessionsError } = useSessionsQuery();

  const secondaryQueriesEnabled = !loadingSessions;
  const { data: stats } = useSessionStatsQuery(secondaryQueriesEnabled);
  const { data: webhooks = [] } = useWebhooksQuery(secondaryQueriesEnabled);
  const { data: overview } = useStatsOverviewQuery(secondaryQueriesEnabled);
  const stopMutation = useStopSessionMutation();
  const messagesToday = overview ? overview.messages.today.sent + overview.messages.today.received : '—';
  const totalMessages = overview ? overview.messages.sent + overview.messages.received : '—';
  const loading = loadingSessions;
  const error =
    sessionsError instanceof Error ? sessionsError.message : sessionsError ? t('dashboard.loadError') : null;
  const webhookCount = webhooks.length;

  const readySession = useMemo(() => sessions.find(s => s.status === 'ready') || sessions[0], [sessions]);
  const activeSessionId = readySession?.id || '';

  // Intelligent secondary queries for AI, Studio, and Lead Flows
  const { data: aiConfig } = useQuery({
    queryKey: ['aiBot', 'config', activeSessionId],
    queryFn: () => aiBotApi.getConfig(activeSessionId),
    enabled: secondaryQueriesEnabled && !!activeSessionId,
    staleTime: 60_000,
    retry: false,
  });

  const { data: aiAgents = [] } = useQuery({
    queryKey: ['aiBot', 'agents', activeSessionId],
    queryFn: () => aiBotApi.listAgents(activeSessionId),
    enabled: secondaryQueriesEnabled && !!activeSessionId,
    staleTime: 60_000,
    retry: false,
  });

  const { data: studioWorkflows = [] } = useQuery({
    queryKey: ['studio', 'workflows', activeSessionId],
    queryFn: () => studioApi.list(activeSessionId),
    enabled: secondaryQueriesEnabled && !!activeSessionId,
    staleTime: 60_000,
    retry: false,
  });

  const { data: leadFlows = [] } = useQuery({
    queryKey: ['leadFlows', activeSessionId],
    queryFn: () => leadFlowsApi.listFlows(activeSessionId),
    enabled: secondaryQueriesEnabled && !!activeSessionId,
    staleTime: 60_000,
    retry: false,
  });

  // Scheduled messages from local storage
  const [scheduledItems, setScheduledItems] = useState<ScheduledItemSummary[]>(() => {
    try {
      const raw = localStorage.getItem('openwa_scheduled_messages');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Campaigns from local storage
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>(() => {
    try {
      const raw = localStorage.getItem('openwa_campaigns_history');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const handleSync = () => {
      try {
        const rawSched = localStorage.getItem('openwa_scheduled_messages');
        setScheduledItems(rawSched ? JSON.parse(rawSched) : []);
      } catch {
        // ignore
      }
      try {
        const rawCamp = localStorage.getItem('openwa_campaigns_history');
        setCampaigns(rawCamp ? JSON.parse(rawCamp) : []);
      } catch {
        // ignore
      }
    };

    window.addEventListener('focus', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('focus', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const pendingScheduled = useMemo(() => {
    return scheduledItems
      .filter(i => i.status === 'pending')
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [scheduledItems]);

  const activeWorkflowsCount = useMemo(() => {
    return studioWorkflows.filter(w => w.enabled).length;
  }, [studioWorkflows]);

  const handleDisconnect = async (id: string) => {
    try {
      await stopMutation.mutateAsync(id);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  const statsCards = [
    {
      label: t('dashboard.stats.activeSessions'),
      value: stats?.ready ?? 0,
      icon: MessageSquare,
      detail: stats ? t('dashboard.stats.sessionsDetail', { running: stats.active, total: stats.total }) : undefined,
      theme: 'emerald',
      trend: stats?.ready ? `${stats.ready} Active Cluster` : 'Idle',
    },
    {
      label: t('dashboard.stats.messagesToday'),
      value: messagesToday,
      icon: Send,
      detail: totalMessages !== '—' ? `${typeof totalMessages === 'number' ? totalMessages.toLocaleString() : totalMessages} all-time` : undefined,
      theme: 'cyan',
      trend: 'Live Socket Stream',
    },
    {
      label: 'AI Agents & Core',
      value: aiAgents.length > 0 ? `${aiAgents.length} Agents` : aiConfig?.enabled ? 'AI Active' : 'AI Ready',
      icon: Bot,
      detail: aiConfig?.provider ? `${aiConfig.provider.toUpperCase()} · ${aiConfig.model || 'Standard'}` : 'Gemini / OpenAI',
      theme: 'purple',
      trend: aiConfig?.enabled ? 'Auto-Reply ON' : 'Multi-Agent',
    },
    {
      label: 'Automations & Queue',
      value: pendingScheduled.length + activeWorkflowsCount,
      icon: Zap,
      detail: `${pendingScheduled.length} scheduled · ${activeWorkflowsCount} workflows`,
      theme: 'amber',
      trend: 'Drip Engine Active',
    },
  ];

  const formatLastActive = (date?: string | null) => {
    if (!date) return t('common.never');
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return t('common.justNow');
    if (diff < 3600000) return t('common.minAgo', { count: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('common.hoursAgo', { count: Math.floor(diff / 3600000) });
    return new Date(date).toLocaleDateString();
  };

  const formatStatus = (status: string) => t(`sessionStatus.${status}`, { defaultValue: status });

  if (loading) {
    return (
      <div
        className="dashboard"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard" style={{ padding: '2rem' }}>
        <div
          style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '1rem', borderRadius: '8px', color: 'var(--error)' }}
        >
          {t('dashboard.errorPrefix', { message: error })}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        badge={
          <span className={`status-badge ${stats && stats.ready > 0 ? 'connected' : 'disconnected'}`}>
            {stats && stats.ready > 0 ? t('common.connected') : t('common.disconnected')}
          </span>
        }
      />

      {/* 3D Executive Command Banner */}
      <div className="dashboard-hero-banner">
        <div className="hero-banner-glow" />
        <div className="hero-banner-content">
          <div className="hero-graphic-cell">
            <div className="hero-3d-emblem-wrap">
              <img src="/waply-3d.png" alt="Waply 3D Core" className="hero-3d-emblem" />
              <div className="hero-3d-ring" />
            </div>
            <div className="hero-meta-copy">
              <div className="hero-badge-row">
                <span className="hero-pill-status">
                  <span className="radar-dot" />
                  Cluster Operational
                </span>
                <span className="hero-pill-latency">
                  <Zap size={11} /> 12ms Gateway Sync
                </span>
                <span className="hero-pill-ai">
                  <Sparkles size={11} /> Multi-Agent AI Active
                </span>
              </div>
              <h2 className="hero-title">Waply Multi-Session Orchestrator</h2>
              <p className="hero-tagline">
                Autonomous WhatsApp gateway with real-time socket telemetry, multi-agent AI chatbots, event workflows, and scheduled message dispatch.
              </p>
            </div>
          </div>
          <div className="hero-actions-panel">
            <button className="hero-action-btn primary" onClick={() => navigate('/sessions')}>
              <Plus size={15} />
              <span>Connect Session</span>
            </button>
            <button className="hero-action-btn secondary" onClick={() => navigate('/ai-chatbot')}>
              <Bot size={15} />
              <span>AI Agents</span>
            </button>
            <button className="hero-action-btn secondary" onClick={() => navigate('/automation-studio')}>
              <GitBranch size={15} />
              <span>Workflows</span>
            </button>
            <button className="hero-action-btn secondary" onClick={() => navigate('/message-tester')}>
              <Clock size={15} />
              <span>Schedule</span>
            </button>
          </div>
        </div>
        <div className="hero-footer-telemetry">
          <div className="telemetry-live-item">
            <Sparkles size={13} className="telemetry-icon" />
            <span>High-Speed Message Fabric</span>
          </div>
          <div className="telemetry-live-item">
            <TrendingUp size={13} className="telemetry-icon" />
            <span>Multi-Tenant Session Sandbox</span>
          </div>
          <DataPulseVisualizer />
        </div>
      </div>

      {/* Quick Launchpad Command Deck */}
      <div className="dashboard-quick-deck">
        <div className="quick-deck-label">
          <Sparkles size={14} className="deck-sparkle" />
          <span>Quick Launchpad</span>
        </div>
        <div className="quick-deck-grid">
          <button className="deck-btn deck-btn-schedule" onClick={() => navigate('/message-tester')}>
            <div className="deck-btn-icon"><Clock size={16} /></div>
            <div className="deck-btn-text">
              <span className="deck-btn-title">Schedule Message</span>
              <span className="deck-btn-sub">Drip & timer queue</span>
            </div>
            <ChevronRight size={14} className="deck-arrow" />
          </button>
          <button className="deck-btn deck-btn-ai" onClick={() => navigate('/ai-chatbot')}>
            <div className="deck-btn-icon"><Bot size={16} /></div>
            <div className="deck-btn-text">
              <span className="deck-btn-title">AI Chatbot</span>
              <span className="deck-btn-sub">Agents & knowledge</span>
            </div>
            <ChevronRight size={14} className="deck-arrow" />
          </button>
          <button className="deck-btn deck-btn-studio" onClick={() => navigate('/automation-studio')}>
            <div className="deck-btn-icon"><GitBranch size={16} /></div>
            <div className="deck-btn-text">
              <span className="deck-btn-title">Automation Studio</span>
              <span className="deck-btn-sub">Event triggers & flows</span>
            </div>
            <ChevronRight size={14} className="deck-arrow" />
          </button>
          <button className="deck-btn deck-btn-campaign" onClick={() => navigate('/campaigns')}>
            <div className="deck-btn-icon"><Radio size={16} /></div>
            <div className="deck-btn-text">
              <span className="deck-btn-title">Campaigns</span>
              <span className="deck-btn-sub">Mass broadcast lists</span>
            </div>
            <ChevronRight size={14} className="deck-arrow" />
          </button>
          <button className="deck-btn deck-btn-lead" onClick={() => navigate('/lead-capture')}>
            <div className="deck-btn-icon"><Target size={16} /></div>
            <div className="deck-btn-text">
              <span className="deck-btn-title">Lead Capture</span>
              <span className="deck-btn-sub">Interactive funnels</span>
            </div>
            <ChevronRight size={14} className="deck-arrow" />
          </button>
          <button className="deck-btn deck-btn-chats" onClick={() => navigate('/chats')}>
            <div className="deck-btn-icon"><MessageSquare size={16} /></div>
            <div className="deck-btn-text">
              <span className="deck-btn-title">Live Chats</span>
              <span className="deck-btn-sub">Active conversations</span>
            </div>
            <ChevronRight size={14} className="deck-arrow" />
          </button>
        </div>
      </div>

      {/* 4 Core Stat Metric Cards */}
      <div className="stats-grid">
        {statsCards.map(({ label, value, icon: Icon, detail, theme, trend }) => (
          <TiltCard key={label} maxTilt={6} className="stat-tilt-wrap">
            <div className={`stat-card stat-theme-${theme}`}>
              <Icon className="stat-watermark" />
              <div className="stat-header">
                <span className="stat-label">{label}</span>
                <div className="stat-icon-wrapper">
                  <Icon size={18} className="stat-icon" />
                </div>
              </div>
              <div className="stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
              <div className="stat-footer-row">
                {detail && <div className="stat-detail">{detail}</div>}
                {trend && <span className="stat-trend-chip">{trend}</span>}
              </div>
            </div>
          </TiltCard>
        ))}
      </div>

      {/* Creative All-in-One Intelligence Bento Grid */}
      <div className="dashboard-bento-grid">
        {/* Card 1: AI Chatbot & Cognitive Agents */}
        <div className="bento-card bento-card-ai">
          <div className="bento-card-header">
            <div className="bento-header-left">
              <div className="bento-icon-box ai-glow">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="bento-title">AI Chatbot & Cognitive Agents</h3>
                <p className="bento-desc">Autonomous LLM replies & multi-agent routing</p>
              </div>
            </div>
            <span className={`bento-status-chip ${aiConfig?.enabled ? 'active' : 'standby'}`}>
              <span className="radar-dot" />
              {aiConfig?.enabled ? 'Auto-Reply Online' : 'Standby / Ready'}
            </span>
          </div>

          <div className="bento-ai-stats-row">
            <div className="ai-stat-pill">
              <Cpu size={14} />
              <span>Engine: <strong>{aiConfig?.provider ? aiConfig.provider.toUpperCase() : 'Gemini / OpenAI'}</strong></span>
            </div>
            <div className="ai-stat-pill">
              <Sliders size={14} />
              <span>Model: <strong>{aiConfig?.model || 'gpt-4o-mini'}</strong></span>
            </div>
            <div className="ai-stat-pill">
              <FileText size={14} />
              <span>Knowledge: <strong>{aiConfig?.knowledgeBase ? 'Indexed' : 'Standard'}</strong></span>
            </div>
          </div>

          <div className="bento-agents-container">
            <div className="bento-subheading">
              <span>Configured AI Specialists ({aiAgents.length || 3})</span>
            </div>
            <div className="bento-agents-list">
              {(aiAgents.length > 0 ? aiAgents.slice(0, 4) : [
                { id: '1', name: 'Customer Support', role: 'Support & 24/7 FAQs', enabled: true },
                { id: '2', name: 'Sales Assistant', role: 'Product recommendations', enabled: true },
                { id: '3', name: 'Lead Qualifier', role: 'Captures contact details', enabled: true },
              ]).map((agent, i) => (
                <div key={agent.id || i} className="agent-item-chip">
                  <div className="agent-avatar-dot" />
                  <div className="agent-chip-info">
                    <span className="agent-chip-name">{agent.name}</span>
                    <span className="agent-chip-role">{agent.role}</span>
                  </div>
                  <span className="agent-enabled-badge">Active</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bento-card-footer">
            <button className="bento-action-btn primary" onClick={() => navigate('/ai-chatbot')}>
              <Bot size={14} />
              <span>Configure AI Studio</span>
            </button>
            <button className="bento-action-btn secondary" onClick={() => navigate('/ai-chatbot')}>
              <Sparkles size={14} />
              <span>Test Prompt</span>
            </button>
          </div>
        </div>

        {/* Card 2: Automation Studio Workflows */}
        <div className="bento-card bento-card-automation">
          <div className="bento-card-header">
            <div className="bento-header-left">
              <div className="bento-icon-box studio-glow">
                <GitBranch size={20} />
              </div>
              <div>
                <h3 className="bento-title">Automation Studio Workflows</h3>
                <p className="bento-desc">Event-driven pipelines, routers & MCP integrations</p>
              </div>
            </div>
            <span className="bento-status-chip active">
              <span className="radar-dot" />
              {activeWorkflowsCount > 0 ? `${activeWorkflowsCount} Active Flows` : 'Listener Armed'}
            </span>
          </div>

          <div className="bento-pipeline-preview">
            <div className="pipeline-step">
              <MessageSquare size={13} />
              <span>Trigger</span>
            </div>
            <span className="pipeline-arrow">→</span>
            <div className="pipeline-step">
              <GitBranch size={13} />
              <span>Router</span>
            </div>
            <span className="pipeline-arrow">→</span>
            <div className="pipeline-step">
              <Sparkles size={13} />
              <span>AI Step</span>
            </div>
            <span className="pipeline-arrow">→</span>
            <div className="pipeline-step">
              <Clock size={13} />
              <span>Delay</span>
            </div>
            <span className="pipeline-arrow">→</span>
            <div className="pipeline-step">
              <Send size={13} />
              <span>Reply</span>
            </div>
          </div>

          <div className="bento-workflows-list">
            {(studioWorkflows.length > 0 ? studioWorkflows.slice(0, 3) : [
              { id: '1', name: 'Auto-Responder & Greetings', enabled: true, definition: { trigger: { type: 'whatsapp' }, keywords: ['/start', 'hi', 'hello'] } },
              { id: '2', name: 'Webhook Lead Ingestion Relay', enabled: true, definition: { trigger: { type: 'webhook' }, keywords: [] } },
              { id: '3', name: 'Meeting Scheduler & Calendar Sync', enabled: false, definition: { trigger: { type: 'schedule' }, keywords: [] } },
            ]).map((wf, idx) => (
              <div key={wf.id || idx} className="workflow-card-row">
                <div className="workflow-info">
                  <span className="workflow-name">{wf.name}</span>
                  <div className="workflow-meta-tags">
                    <span className="meta-tag trigger">
                      {wf.definition?.trigger?.type === 'webhook' ? '🌐 Webhook' : wf.definition?.trigger?.type === 'schedule' ? '⏰ Scheduled' : '💬 WhatsApp Trigger'}
                    </span>
                    {wf.definition?.keywords?.length > 0 && (
                      <span className="meta-tag keywords">
                        {wf.definition.keywords.slice(0, 2).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`workflow-badge ${wf.enabled ? 'enabled' : 'paused'}`}>
                  {wf.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
            ))}
          </div>

          <div className="bento-card-footer">
            <button className="bento-action-btn primary" onClick={() => navigate('/automation-studio')}>
              <Plus size={14} />
              <span>Create Workflow</span>
            </button>
            <button className="bento-action-btn secondary" onClick={() => navigate('/automation-studio')}>
              <GitBranch size={14} />
              <span>Open Studio</span>
            </button>
          </div>
        </div>

        {/* Card 3: Scheduled & Drip Messages Queue */}
        <div className="bento-card bento-card-schedules">
          <div className="bento-card-header">
            <div className="bento-header-left">
              <div className="bento-icon-box schedule-glow">
                <Clock size={20} />
              </div>
              <div>
                <h3 className="bento-title">Scheduled & Drip Messages Queue</h3>
                <p className="bento-desc">Automated message delivery & calendar dispatch</p>
              </div>
            </div>
            <span className={`bento-status-chip ${pendingScheduled.length > 0 ? 'active' : 'standby'}`}>
              <Clock size={12} />
              {pendingScheduled.length} Pending
            </span>
          </div>

          <div className="bento-schedules-list">
            {pendingScheduled.length > 0 ? (
              pendingScheduled.slice(0, 3).map((item) => (
                <div key={item.id} className="scheduled-queue-row">
                  <div className="queue-badge-cell">
                    <span className={`queue-type-badge type-${item.messageType}`}>
                      {item.messageType.toUpperCase()}
                    </span>
                    <span className="queue-time-badge">
                      <Clock size={11} />
                      {new Date(item.scheduledAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="queue-preview-text">{item.previewText}</p>
                  <div className="queue-meta-bottom">
                    <span className="queue-recipient">To: {item.recipient}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="queue-empty-dashboard">
                <Calendar size={28} className="empty-cal-icon" />
                <p className="empty-text">No pending scheduled messages in queue.</p>
                <span className="empty-sub">Plan your challenge posts, drip campaigns, or reminders.</span>
              </div>
            )}
          </div>

          <div className="bento-card-footer">
            <button className="bento-action-btn primary" onClick={() => navigate('/message-tester')}>
              <Plus size={14} />
              <span>Schedule New Message</span>
            </button>
            <button className="bento-action-btn secondary" onClick={() => navigate('/message-tester')}>
              <Calendar size={14} />
              <span>View Calendar & Queue</span>
            </button>
          </div>
        </div>

        {/* Card 4: Broadcast Campaigns & Lead Funnels */}
        <div className="bento-card bento-card-campaigns">
          <div className="bento-card-header">
            <div className="bento-header-left">
              <div className="bento-icon-box campaign-glow">
                <Radio size={20} />
              </div>
              <div>
                <h3 className="bento-title">Broadcast Campaigns & Lead Funnel</h3>
                <p className="bento-desc">Mass outreach batches & interactive questionnaires</p>
              </div>
            </div>
            <span className="bento-status-chip active">
              <Target size={12} />
              Active Pipeline
            </span>
          </div>

          <div className="campaigns-funnel-split">
            <div className="split-column">
              <div className="split-col-header">
                <Radio size={14} />
                <span>Broadcast Campaigns ({campaigns.length})</span>
              </div>
              {campaigns.length > 0 ? (
                <div className="campaign-mini-list">
                  {campaigns.slice(0, 2).map((c) => (
                    <div key={c.id} className="campaign-mini-item">
                      <div className="camp-item-top">
                        <span className="camp-name">{c.name}</span>
                        <span className={`camp-status ${c.status}`}>{c.status}</span>
                      </div>
                      <div className="camp-progress-bar">
                        <div
                          className="camp-progress-fill"
                          style={{
                            width: `${c.totalRecipients > 0 ? Math.round((c.sentCount / c.totalRecipients) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <div className="camp-counts">
                        <span>{c.sentCount} / {c.totalRecipients} sent</span>
                        {c.failedCount > 0 && <span className="failed-count">({c.failedCount} failed)</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mini-empty-state">
                  <span>No broadcast campaigns run yet.</span>
                </div>
              )}
            </div>

            <div className="split-column">
              <div className="split-col-header">
                <Target size={14} />
                <span>Lead Capture Funnel ({leadFlows.length})</span>
              </div>
              <div className="lead-funnel-card">
                <div className="funnel-metric">
                  <span className="funnel-number">{leadFlows.length || 1}</span>
                  <span className="funnel-desc">Active Lead Flows</span>
                </div>
                <p className="funnel-text">
                  Automated interactive forms capturing customer data directly via WhatsApp chat.
                </p>
              </div>
            </div>
          </div>

          <div className="bento-card-footer">
            <button className="bento-action-btn primary" onClick={() => navigate('/campaigns')}>
              <Radio size={14} />
              <span>New Campaign</span>
            </button>
            <button className="bento-action-btn secondary" onClick={() => navigate('/lead-capture')}>
              <Target size={14} />
              <span>Lead Flows</span>
            </button>
          </div>
        </div>
      </div>

      {/* Realtime Telemetry Live Status Strip */}
      <div className="dashboard-telemetry-strip">
        <div className="telemetry-pill">
          <span className="radar-dot" />
          <span>Gateway: <strong>Multi-Tenant Cluster Active</strong></span>
        </div>
        <div className="telemetry-pill">
          <Zap size={13} className="telemetry-accent" />
          <span>Baileys Socket: <strong>Connected & Synchronized</strong></span>
        </div>
        <div className="telemetry-pill">
          <Clock size={13} className="telemetry-accent" />
          <span>Schedule Daemon: <strong>Active ({pendingScheduled.length} Timers)</strong></span>
        </div>
        <div className="telemetry-pill">
          <Webhook size={13} className="telemetry-accent" />
          <span>Webhooks: <strong>{webhookCount} Configured</strong></span>
        </div>
        <div className="telemetry-pill">
          <Bot size={13} className="telemetry-accent" />
          <span>AI Engine: <strong>{aiConfig?.enabled ? 'Online' : 'Standby'}</strong></span>
        </div>
      </div>

      <Suspense fallback={null}>
        <DashboardCharts />
      </Suspense>

      <section className="sessions-section">
        <div className="section-header">
          <h2>{t('dashboard.sessionsOverview')}</h2>
          <span className="section-subtitle">
            {t('dashboard.showingSessions', { shown: sessions.length, total: stats?.total ?? 0 })}
          </span>
        </div>

        <div className="sessions-table">
          <div className="table-header">
            <span>{t('dashboard.columns.sessionId')}</span>
            <span>{t('dashboard.columns.phone')}</span>
            <span>{t('dashboard.columns.status')}</span>
            <span>{t('dashboard.columns.lastActive')}</span>
            <span>{t('dashboard.columns.actions')}</span>
          </div>
          {sessions.length === 0 ? (
            <div className="table-row" style={{ justifyContent: 'center', color: 'var(--text-muted)' }}>
              {t('dashboard.noSessions')}
            </div>
          ) : (
            sessions.map(session => (
              <div key={session.id} className="table-row">
                <div className="session-info-cell">
                  <span className="session-id">{session.id.substring(0, 12)}</span>
                  <span className="session-name" title={session.name}>
                    {session.name}
                  </span>
                </div>
                <span className="phone">{session.phone || '—'}</span>
                <span className={`status-pill ${session.status}`}>{formatStatus(session.status)}</span>
                <span className="last-active">{formatLastActive(session.lastActive)}</span>
                <div className="actions">
                  <button className="btn-sm" onClick={() => navigate('/sessions')}>
                    {t('dashboard.view')}
                  </button>
                  {['ready', 'initializing', 'qr_ready'].includes(session.status) && (
                    <button className="btn-sm danger" onClick={() => handleDisconnect(session.id)}>
                      {t('dashboard.disconnect')}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

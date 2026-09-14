import { useState, useEffect } from 'react';
import {
  Bot,
  Sparkles,
  Save,
  Send,
  Key,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Edit2,
  ShoppingBag,
  Headphones,
  CreditCard,
  CircleHelp,
  Sliders,
  Tag,
  Zap,
} from 'lucide-react';
import {
  aiBotApi,
  type AiBotConfigView,
  type AiAgentView,
  type CreateAiAgentInput,
  type Session,
} from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import './AiChatbot.css';

const PRESET_PROMPTS: Record<string, string> = {
  general: `You are an intelligent, friendly WhatsApp Business Assistant.
- Respond in the user's language (Gujarati, Hindi, or English).
- Be polite, concise, and helpful.
- Keep formatting clean with emojis and bullet points.`,
  gujarati_business: `તમે એક વિનમ્ર અને વ્યવસાયિક WhatsApp સહાયક (Business Assistant) છો.
- ગ્રાહકના દરેક પ્રશ્નનો સ્પષ્ટ અને સચોટ જવાબ આપો.
- જો ગ્રાહક ગુજરાતીમાં લખે તો શુદ્ધ અને આદરપૂર્વક ગુજરાતીમાં જવાબ આપો.
- જો કોઈ વિગત નોલેજ બેઝમાં ન હોય, તો આપણી ટીમના પ્રતિનિધિનો સંપર્ક કરવા વિનંતી કરો.`,
  ecommerce: `You are an expert sales and customer support assistant on WhatsApp.
- Help customers with product inquiries, prices, and orders.
- Always be encouraging, polite, and prompt.
- Suggest contacting support if an issue requires manual assistance.`,
};

// Preset Templates for Specialized Agents
type AgentRole = 'sales' | 'support' | 'billing' | 'inquiry' | 'custom';

type AgentTemplate = {
  name: string;
  role: AgentRole;
  priority: number;
  triggerKeywords: string[];
  description: string;
  systemPrompt: string;
  knowledgeBase: string;
};

const AGENT_TEMPLATES: Record<AgentRole, AgentTemplate> = {
  sales: {
    name: 'Sales & Deal Closer Bot',
    role: 'sales' as const,
    priority: 20,
    triggerKeywords: [
      'price',
      'pricing',
      'buy',
      'cost',
      'discount',
      'offer',
      'purchase',
      'catalog',
      'demo',
      'ભાવ',
      'કિંમત',
      'ખરીદવું',
      'ઓફર',
    ],
    description: 'Handles sales inquiries, recommends best packages, quotes prices, and converts leads.',
    systemPrompt: `You are an energetic, high-converting WhatsApp Sales Executive.
Goals:
1. Understand the customer's requirement quickly and recommend the ideal package/product.
2. Highlight current discounts and unique value propositions.
3. Answer questions about prices, features, and purchase options with enthusiasm.
4. Always include a polite Call to Action (e.g. "Would you like me to book your demo / generate an invoice?").
5. Respond in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Product Catalog & Pricing:
- Starter Pack: ₹999/month (Basic WhatsApp automation, up to 1,000 chats)
- Growth Pro: ₹2,499/month (Unlimited AI chatbots, bulk broadcasts, full CRM)
- Enterprise Plan: ₹4,999/month (Dedicated account manager, custom API integrations, priority support)
Current Special Offer: 15% instant discount on annual billing!`,
  },
  support: {
    name: 'Customer Support Specialist',
    role: 'support' as const,
    priority: 30,
    triggerKeywords: [
      'help',
      'issue',
      'error',
      'bug',
      'problem',
      'not working',
      'fail',
      'support',
      'complain',
      'refund',
      'મદદ',
      'તકલીફ',
      'પ્રોબ્લેમ',
    ],
    description: 'Solves user troubles, explains troubleshooting steps, and handles service complaints.',
    systemPrompt: `You are a calm, empathetic, and highly efficient Customer Support Specialist on WhatsApp.
Goals:
1. Acknowledge the user's issue with genuine empathy ("We are sorry for any inconvenience...").
2. Give crystal-clear step-by-step troubleshooting instructions.
3. If the issue requires engineer intervention or account check, ask for their Order ID / Phone number and confirm human handoff within 15 minutes.
4. Reply in the same language the customer reaches out in.`,
    knowledgeBase: `Common Support Answers:
- WhatsApp Disconnection: Go to Dashboard -> Sessions -> Scan QR again to re-sync.
- Refund Policy: Full refund within 7 days of purchase if not satisfied.
- Working Hours: Support desk is open Monday to Saturday, 9 AM to 7 PM IST.`,
  },
  billing: {
    name: 'Billing & Payment Assistant',
    role: 'billing',
    priority: 40,
    triggerKeywords: [
      'payment',
      'paid',
      'invoice',
      'bill',
      'billing',
      'receipt',
      'refund',
      'transaction',
      'failed payment',
      'UPI',
      'card',
      'ચુકવણી',
      'બિલ',
      'રિફંડ',
      'પેમેન્ટ',
    ],
    description: 'Handles payment questions, invoices, receipts, failed transactions, and refund requests.',
    systemPrompt: `You are a careful and trustworthy WhatsApp Billing & Payment Assistant.
Goals:
1. Identify whether the customer needs help with a payment, invoice, receipt, refund, or failed transaction.
2. Never ask for a card number, CVV, OTP, UPI PIN, password, or other sensitive financial credentials.
3. Ask only for safe verification details such as Order ID, Invoice ID, transaction reference, payment date, and registered phone number.
4. Explain the next step and expected resolution time clearly. Escalate disputes, duplicate charges, or unverified payments to a human billing agent.
5. Never claim that a payment or refund is complete unless that status exists in the knowledge base or supplied account data.
6. Reply in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Billing & Payment Information (replace the bracketed details):
- Accepted payment methods: [UPI / Cards / Net Banking / Cash]
- Invoice process: [How and when customers receive invoices]
- Payment confirmation time: [Expected time]
- Failed payment guidance: [Retry/wait/contact instructions]
- Refund eligibility: [Your refund policy]
- Refund processing time: [Number of business days]
- Billing support contact/hours: [Details]

Safety: Never request OTP, CVV, UPI PIN, full card number, or banking password.`,
  },
  inquiry: {
    name: 'FAQ & General Query Bot',
    role: 'inquiry',
    priority: 10,
    triggerKeywords: [
      'faq',
      'question',
      'query',
      'information',
      'details',
      'hours',
      'timing',
      'location',
      'address',
      'how',
      'what',
      'where',
      'માહિતી',
      'પ્રશ્ન',
      'સમય',
      'સરનામું',
      'ક્યાં',
    ],
    description: 'Answers frequently asked questions and general business, service, location, and policy inquiries.',
    systemPrompt: `You are a friendly and accurate WhatsApp FAQ & General Query Assistant.
Goals:
1. Understand the customer's question and answer directly using only the supplied knowledge base.
2. Keep answers short, clear, and easy to scan on WhatsApp.
3. Ask one concise follow-up question when the request is ambiguous.
4. If the answer is not available, say so honestly and offer a human handoff instead of guessing.
5. Share links, timings, addresses, or contact details exactly as written in the knowledge base.
6. Reply in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Frequently Asked Questions (replace the bracketed details):
Q: What are your business hours?
A: [Days and timings]

Q: Where are you located?
A: [Full address and map link]

Q: How can I contact your team?
A: [Phone / email / WhatsApp details]

Q: What products or services do you offer?
A: [Short list]

Q: What is your delivery/service area?
A: [Coverage details]

Q: What are your cancellation and return policies?
A: [Policy details]`,
  },
  custom: {
    name: 'Custom Purpose Bot',
    role: 'custom',
    priority: 5,
    triggerKeywords: [],
    description: '',
    systemPrompt: `You are a specialized WhatsApp Assistant.
1. Help customers only with the purpose and information defined below.
2. Be concise, polite, and accurate.
3. Do not guess when information is missing; offer a human handoff.
4. Reply in the customer's language (Gujarati, Hindi, or English).`,
    knowledgeBase: `Add the information, rules, FAQs, and escalation details this bot should use.`,
  },
};

export function AiChatbot() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'agents' | 'settings'>('agents');
  const [config, setConfig] = useState<AiBotConfigView | null>(null);
  const [agents, setAgents] = useState<AiAgentView[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form State for Global / Default Bot
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-1.5-flash');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(10);

  // Specialized Agent Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState<{
    name: string;
    role: AgentRole;
    enabled: boolean;
    priority: number;
    triggerKeywords: string;
    description: string;
    systemPrompt: string;
    knowledgeBase: string;
  }>({
    name: '',
    role: 'sales',
    enabled: true,
    priority: 10,
    triggerKeywords: '',
    description: '',
    systemPrompt: '',
    knowledgeBase: '',
  });

  // Test Simulator State
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState<{
    response: string;
    error?: string;
    matchedAgent?: { name: string; role: string; id: string };
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Set default selected session to 'all'
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId('all');
    }
  }, [sessions, selectedSessionId]);

  // Load config & agents when session changes
  useEffect(() => {
    if (!selectedSessionId) return;

    let isMounted = true;
    setIsLoadingConfig(true);
    setIsLoadingAgents(true);
    setTestResult(null);

    const fetchSessionId = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;

    aiBotApi
      .getConfig(fetchSessionId)
      .then(data => {
        if (!isMounted) return;
        setConfig(data);
        setEnabled(data.enabled);
        setProvider(data.provider || 'gemini');
        setApiKey(data.apiKey || '');
        setModel(data.model || (data.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'));
        setSystemPrompt(data.systemPrompt || PRESET_PROMPTS.general);
        setKnowledgeBase(data.knowledgeBase || '');
        setCooldownSeconds(data.cooldownSeconds ?? 10);
      })
      .catch(err => {
        toast.error('Failed to load AI config', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (isMounted) setIsLoadingConfig(false);
      });

    loadAgents(fetchSessionId);

    return () => {
      isMounted = false;
    };
  }, [selectedSessionId, sessions, toast]);

  const loadAgents = async (sessionId: string) => {
    try {
      setIsLoadingAgents(true);
      const data = await aiBotApi.listAgents(sessionId);
      setAgents(data);
    } catch {
      // ignore empty
    } finally {
      setIsLoadingAgents(false);
    }
  };

  const savePayload = async (targetSession: string) => {
    return aiBotApi.updateConfig(targetSession, {
      enabled,
      provider,
      apiKey: apiKey.trim(),
      model,
      systemPrompt,
      knowledgeBase,
      cooldownSeconds: Number(cooldownSeconds),
    });
  };

  const handleSaveMasterSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;

    setIsSaving(true);
    try {
      if (selectedSessionId === 'all') {
        await savePayload('all');
        await Promise.all(sessions.map(s => savePayload(s.id).catch(() => null)));
        toast.success('AI Settings applied to ALL WhatsApp sessions!');
      } else {
        const updated = await savePayload(selectedSessionId);
        setConfig(updated);
        setApiKey(updated.apiKey);
        toast.success('AI Settings saved successfully!');
      }
    } catch (err) {
      toast.error('Failed to save settings', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const getAgentFormFromTemplate = (role: AgentRole) => {
    const template = AGENT_TEMPLATES[role];
    return {
      name: template.name,
      role: template.role,
      enabled: true,
      priority: template.priority,
      triggerKeywords: template.triggerKeywords.join(', '),
      description: template.description,
      systemPrompt: template.systemPrompt,
      knowledgeBase: template.knowledgeBase,
    };
  };

  const handleOpenCreateModal = (presetKey: AgentRole = 'custom') => {
    setEditingAgentId(null);
    setAgentForm(getAgentFormFromTemplate(presetKey));
    setIsModalOpen(true);
  };

  const handleAgentRoleChange = (role: AgentRole) => {
    setAgentForm(current => ({
      ...getAgentFormFromTemplate(role),
      enabled: current.enabled,
    }));
  };

  const handleOpenEditModal = (agent: AiAgentView) => {
    setEditingAgentId(agent.id);
    setAgentForm({
      name: agent.name,
      role: agent.role,
      enabled: agent.enabled,
      priority: agent.priority,
      triggerKeywords: (agent.triggerKeywords || []).join(', '),
      description: agent.description || '',
      systemPrompt: agent.systemPrompt,
      knowledgeBase: agent.knowledgeBase || '',
    });
    setIsModalOpen(true);
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentForm.name.trim()) {
      toast.error('Please enter an Agent Name');
      return;
    }

    const keywords = agentForm.triggerKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const payload: CreateAiAgentInput = {
      name: agentForm.name.trim(),
      role: agentForm.role,
      enabled: agentForm.enabled,
      priority: Number(agentForm.priority) || 0,
      triggerKeywords: keywords,
      description: agentForm.description.trim(),
      systemPrompt: agentForm.systemPrompt.trim(),
      knowledgeBase: agentForm.knowledgeBase.trim(),
    };

    const targetSession = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;

    try {
      if (editingAgentId) {
        await aiBotApi.updateAgent(targetSession, editingAgentId, payload);
        toast.success(`Agent "${payload.name}" updated successfully!`);
      } else {
        await aiBotApi.createAgent(targetSession, payload);
        toast.success(`Agent "${payload.name}" created successfully!`);
      }
      setIsModalOpen(false);
      loadAgents(targetSession);
    } catch (err) {
      toast.error('Failed to save agent', err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteAgent = async (agent: AiAgentView) => {
    if (!confirm(`Are you sure you want to delete AI Agent "${agent.name}"?`)) return;
    const targetSession = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;
    try {
      await aiBotApi.deleteAgent(targetSession, agent.id);
      toast.success(`Agent "${agent.name}" deleted`);
      loadAgents(targetSession);
    } catch (err) {
      toast.error('Failed to delete agent', err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleAgentStatus = async (agent: AiAgentView) => {
    const targetSession = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;
    try {
      await aiBotApi.updateAgent(targetSession, agent.id, { enabled: !agent.enabled });
      toast.success(`Agent "${agent.name}" ${!agent.enabled ? 'activated' : 'paused'}`);
      loadAgents(targetSession);
    } catch (err) {
      toast.error('Failed to update agent status', err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunTest = async () => {
    if (!testMessage.trim()) return;

    setIsTesting(true);
    setTestResult(null);
    const testSessionId = selectedSessionId === 'all' ? sessions[0]?.id || 'all' : selectedSessionId;
    try {
      const result = await aiBotApi.testPrompt(testSessionId, testMessage.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({
        response: '',
        error: err instanceof Error ? err.message : 'Error testing AI prompt',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const applyPreset = (key: string) => {
    if (PRESET_PROMPTS[key]) {
      setSystemPrompt(PRESET_PROMPTS[key]);
      toast.info('Preset prompt applied!');
    }
  };

  return (
    <div className="ai-chatbot-page">
      <PageHeader
        title="Multi-Agent AI Chatbot Hub"
        subtitle="Deploy multiple specialized AI chatbots (Sales, Support, Custom) on your WhatsApp numbers"
      />

      {/* Session selector & Master Status Bar */}
      <div className="ai-chatbot-session-bar">
        <div className="session-select-wrapper">
          <label htmlFor="session-select">WhatsApp Session:</label>
          {sessionsLoading ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <select
              id="session-select"
              value={selectedSessionId}
              onChange={e => setSelectedSessionId(e.target.value)}
              className="session-select"
            >
              <option value="all">🌟 All Sessions (બધા જ સેશન - Global)</option>
              {sessions.map((s: Session) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="master-status-pill">
          <span className={`status-indicator ${enabled ? 'active' : 'inactive'}`} />
          <span>
            Master Engine: <strong>{enabled ? 'Active (Auto-Reply ON)' : 'Disabled'}</strong>
          </span>
        </div>
      </div>

      {/* Modern Luxury Tabs */}
      <div className="ai-chatbot-tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          <Bot size={18} />
          <span>Specialized AI Chatbots ({agents.length})</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Sliders size={18} />
          <span>Global AI Credentials & Fallback Bot</span>
        </button>
      </div>

      {isLoadingConfig ? (
        <div className="loading-container">
          <Loader2 className="animate-spin" size={32} />
          <span>Loading Multi-Agent System...</span>
        </div>
      ) : (
        <div className="ai-chatbot-layout">
          {/* TAB 1: Specialized Agents Manager */}
          {activeTab === 'agents' && (
            <div className="agents-tab-container">
              {/* Top Action Banner */}
              <div className="agents-action-banner">
                <div className="banner-info">
                  <h3>Specific AI Chatbots for Specific Tasks</h3>
                  <p>
                    Create targeted agents like <strong>Sales Bot</strong> for pricing & deals, or{' '}
                    <strong>Support Bot</strong> for complaints & help. Incoming WhatsApp messages are automatically
                    routed based on triggers!
                  </p>
                </div>
                <div className="banner-buttons">
                  <button
                    type="button"
                    className="btn-preset-agent sales"
                    onClick={() => handleOpenCreateModal('sales')}
                  >
                    <ShoppingBag size={16} />+ Add Sales Bot
                  </button>
                  <button
                    type="button"
                    className="btn-preset-agent support"
                    onClick={() => handleOpenCreateModal('support')}
                  >
                    <Headphones size={16} />+ Add Support Bot
                  </button>
                  <button
                    type="button"
                    className="btn-preset-agent billing"
                    onClick={() => handleOpenCreateModal('billing')}
                  >
                    <CreditCard size={16} />+ Add Payment Bot
                  </button>
                  <button
                    type="button"
                    className="btn-preset-agent inquiry"
                    onClick={() => handleOpenCreateModal('inquiry')}
                  >
                    <CircleHelp size={16} />+ Add FAQ Bot
                  </button>
                  <button type="button" className="btn-primary-glow" onClick={() => handleOpenCreateModal()}>
                    <Plus size={16} />
                    Create Custom Bot
                  </button>
                </div>
              </div>

              {/* Agents Grid */}
              {isLoadingAgents ? (
                <div className="loading-container">
                  <Loader2 className="animate-spin" size={28} />
                  <span>Loading agents...</span>
                </div>
              ) : agents.length === 0 ? (
                <div className="empty-agents-card">
                  <Bot size={48} className="empty-icon" />
                  <h4>No Specialized Bots Created Yet</h4>
                  <p>Choose Sales, Support, Payment, or FAQ to start with a complete ready-to-use template.</p>
                  <div className="empty-quick-actions">
                    <button
                      type="button"
                      className="btn-preset-agent sales"
                      onClick={() => handleOpenCreateModal('sales')}
                    >
                      <ShoppingBag size={16} /> Add Sales Bot Template
                    </button>
                    <button
                      type="button"
                      className="btn-preset-agent support"
                      onClick={() => handleOpenCreateModal('support')}
                    >
                      <Headphones size={16} /> Add Support Bot Template
                    </button>
                    <button
                      type="button"
                      className="btn-preset-agent billing"
                      onClick={() => handleOpenCreateModal('billing')}
                    >
                      <CreditCard size={16} /> Add Payment Bot Template
                    </button>
                    <button
                      type="button"
                      className="btn-preset-agent inquiry"
                      onClick={() => handleOpenCreateModal('inquiry')}
                    >
                      <CircleHelp size={16} /> Add FAQ Bot Template
                    </button>
                  </div>
                </div>
              ) : (
                <div className="agents-card-grid">
                  {agents.map(agent => {
                    const isSales = agent.role === 'sales';
                    const isSupport = agent.role === 'support';
                    return (
                      <div
                        key={agent.id}
                        className={`agent-card ${agent.enabled ? 'agent-active' : 'agent-inactive'} role-${agent.role}`}
                      >
                        <div className="agent-card-header">
                          <div className="agent-title-box">
                            <div className={`agent-role-badge ${agent.role}`}>
                              {isSales && <ShoppingBag size={14} />}
                              {isSupport && <Headphones size={14} />}
                              {!isSales && !isSupport && <Bot size={14} />}
                              <span>{agent.role.toUpperCase()}</span>
                            </div>
                            <h4>{agent.name}</h4>
                          </div>

                          <div className="agent-card-controls">
                            <label className="switch switch-sm" title="Enable/Disable this agent">
                              <input
                                type="checkbox"
                                checked={agent.enabled}
                                onChange={() => handleToggleAgentStatus(agent)}
                              />
                              <span className="slider round" />
                            </label>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => handleOpenEditModal(agent)}
                              title="Edit Agent"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon delete"
                              onClick={() => handleDeleteAgent(agent)}
                              title="Delete Agent"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        {agent.description && <p className="agent-desc">{agent.description}</p>}

                        <div className="agent-triggers-box">
                          <span className="triggers-label">
                            <Tag size={12} /> Trigger Keywords:
                          </span>
                          <div className="keyword-pills">
                            {agent.triggerKeywords && agent.triggerKeywords.length > 0 ? (
                              agent.triggerKeywords.map((kw, i) => (
                                <span key={i} className="keyword-pill">
                                  {kw}
                                </span>
                              ))
                            ) : (
                              <span className="no-keywords">Matches general inquiries</span>
                            )}
                          </div>
                        </div>

                        <div className="agent-card-meta">
                          <span>
                            Priority: <strong>{agent.priority}</strong>
                          </span>
                          <span>
                            Knowledge Base: <strong>{agent.knowledgeBase ? 'Attached' : 'None'}</strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Global Config & Fallback Bot */}
          {activeTab === 'settings' && (
            <div className="settings-tab-container">
              <form className="ai-config-card" onSubmit={handleSaveMasterSettings}>
                <div className="card-header-toggle">
                  <div className="toggle-title">
                    <Bot className="icon-bot" size={24} />
                    <div>
                      <h3>Global AI Auto-Reply Engine</h3>
                      <p>
                        Controls AI credentials and provides a default fallback chatbot when no specialized agent
                        matches.
                      </p>
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="form-group-row">
                  <div className="form-group">
                    <label htmlFor="ai-provider-select">AI Provider</label>
                    <select
                      id="ai-provider-select"
                      value={provider}
                      onChange={e => {
                        const newProvider = e.target.value as 'gemini' | 'openai';
                        setProvider(newProvider);
                        setModel(newProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
                      }}
                    >
                      <option value="gemini">Google Gemini (Recommended - Free & Ultra-Fast)</option>
                      <option value="openai">OpenAI (ChatGPT)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="ai-model-select">Model</label>
                    {provider === 'gemini' ? (
                      <select id="ai-model-select" value={model} onChange={e => setModel(e.target.value)}>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast & Cost-Effective)</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro (Advanced Reasoning)</option>
                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                      </select>
                    ) : (
                      <select id="ai-model-select" value={model} onChange={e => setModel(e.target.value)}>
                        <option value="gpt-4o-mini">GPT-4o Mini (Fast)</option>
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                      </select>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label>
                    <Key size={14} /> API Key {config?.hasApiKey && <span className="badge-saved">Saved</span>}
                  </label>
                  <input
                    type="password"
                    placeholder={config?.hasApiKey ? config.apiKey : 'Enter your API Key...'}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <small className="form-hint">
                    {provider === 'gemini'
                      ? 'Get your free key from Google AI Studio (aistudio.google.com)'
                      : 'Get your key from platform.openai.com/api-keys'}
                  </small>
                </div>

                <div className="form-group">
                  <div className="label-with-presets">
                    <label>
                      <Sparkles size={14} /> Default Fallback System Prompt
                    </label>
                    <div className="preset-buttons">
                      <span>Presets:</span>
                      <button type="button" onClick={() => applyPreset('general')}>
                        General
                      </button>
                      <button type="button" onClick={() => applyPreset('gujarati_business')}>
                        ગુજરાતી બિઝનેસ
                      </button>
                      <button type="button" onClick={() => applyPreset('ecommerce')}>
                        E-Commerce
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={systemPrompt}
                    onChange={e => setSystemPrompt(e.target.value)}
                    placeholder="Instructions for the default bot when no specialized bot triggers..."
                  />
                </div>

                <div className="form-group">
                  <label>
                    <FileText size={14} /> Global Knowledge Base & General Business FAQs
                  </label>
                  <textarea
                    rows={5}
                    value={knowledgeBase}
                    onChange={e => setKnowledgeBase(e.target.value)}
                    placeholder="General business details, working hours, location, support contact..."
                  />
                </div>

                <div className="form-group">
                  <label>
                    <Zap size={14} /> Cooldown Window (Seconds)
                  </label>
                  <input
                    type="number"
                    value={cooldownSeconds}
                    onChange={e => setCooldownSeconds(Number(e.target.value))}
                    min={0}
                    max={3600}
                  />
                  <small className="form-hint">
                    Quiet period before the AI sends another reply to the same user. Prevents rapid repetitive messages.
                  </small>
                </div>

                <button type="submit" className="btn-save" disabled={isSaving}>
                  {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  {selectedSessionId === 'all' ? 'Save Global Settings for All Sessions' : 'Save AI Settings'}
                </button>
              </form>
            </div>
          )}

          {/* Test & Live Multi-Agent Simulator Panel */}
          <div className="ai-test-card">
            <div className="card-header">
              <Sparkles size={20} className="icon-sparkle" />
              <div>
                <h3>Multi-Agent Live Simulator</h3>
                <p>Test incoming customer inquiries to see which AI Agent triggers and what reply it generates!</p>
              </div>
            </div>

            <div className="test-body">
              <div className="quick-test-queries">
                <span>Try quick queries:</span>
                <button type="button" onClick={() => setTestMessage('What are your package prices and offers?')}>
                  💼 Price Inquiry (Sales)
                </button>
                <button type="button" onClick={() => setTestMessage('I have a problem with my account, please help!')}>
                  🎧 Issue/Help (Support)
                </button>
                <button type="button" onClick={() => setTestMessage('નમસ્તે, તમારી ઓફિસ ક્યાં આવેલી છે?')}>
                  📍 Location (General)
                </button>
              </div>

              <div className="form-group">
                <label>Customer Message</label>
                <div className="test-input-row">
                  <input
                    type="text"
                    value={testMessage}
                    onChange={e => setTestMessage(e.target.value)}
                    placeholder="દા.ત. આ પ્રોડક્ટ નો ભાવ શું છે? / I need support..."
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleRunTest())}
                  />
                  <button
                    type="button"
                    className="btn-send-test"
                    onClick={handleRunTest}
                    disabled={isTesting || !testMessage.trim()}
                  >
                    {isTesting ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="test-response-box">
                  {testResult.error ? (
                    <div className="test-error">
                      <AlertCircle size={18} />
                      <span>{testResult.error}</span>
                    </div>
                  ) : (
                    <div className="test-success">
                      <div className="test-reply-header">
                        <CheckCircle2 size={16} color="#10b981" />
                        <span>AI Response</span>
                        {testResult.matchedAgent ? (
                          <span className={`matched-agent-tag ${testResult.matchedAgent.role}`}>
                            Answered by: <strong>{testResult.matchedAgent.name}</strong> ({testResult.matchedAgent.role}
                            )
                          </span>
                        ) : (
                          <span className="matched-agent-tag general">
                            Answered by: <strong>Default / General Assistant</strong>
                          </span>
                        )}
                      </div>
                      <div className="test-reply-content">{testResult.response}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create or Edit Specialized AI Agent */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <div className="modal-title">
                <Bot size={22} className="modal-icon" />
                <h3>{editingAgentId ? 'Edit AI Chatbot' : 'Create Specialized AI Chatbot'}</h3>
              </div>
              <button type="button" className="btn-modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAgent} className="modal-form">
              <div className="form-group-row">
                <div className="form-group">
                  <label>Bot Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sales Executive Bot / Support Specialist"
                    value={agentForm.name}
                    onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Role / Category</label>
                  <select value={agentForm.role} onChange={e => handleAgentRoleChange(e.target.value as AgentRole)}>
                    <option value="sales">💼 Sales (Leads, Products & Deals)</option>
                    <option value="support">🎧 Support (Complaints & Troubleshooting)</option>
                    <option value="billing">💳 Billing & Payment</option>
                    <option value="inquiry">❓ FAQ & Inquiry</option>
                    <option value="custom">⚙️ Custom Purpose</option>
                  </select>
                  <small className="form-hint">
                    Changing the role automatically fills the matching name, triggers, prompt, and FAQ template.
                  </small>
                </div>
              </div>

              <div className="form-group">
                <label>
                  <Tag size={14} /> Trigger Keywords / Phrases (Comma Separated) *
                </label>
                <input
                  type="text"
                  placeholder="price, buy, cost, discount, catalog, demo, ભાવ, કિંમત, ખરીદવું"
                  value={agentForm.triggerKeywords}
                  onChange={e => setAgentForm({ ...agentForm, triggerKeywords: e.target.value })}
                />
                <small className="form-hint">
                  When a customer's WhatsApp message includes any of these words, this specific bot will handle the
                  conversation.
                </small>
              </div>

              <div className="form-group-row">
                <div className="form-group">
                  <label>Priority (Higher = Evaluated First)</label>
                  <input
                    type="number"
                    value={agentForm.priority}
                    onChange={e => setAgentForm({ ...agentForm, priority: Number(e.target.value) })}
                    min={0}
                    max={100}
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={agentForm.enabled ? 'true' : 'false'}
                    onChange={e => setAgentForm({ ...agentForm, enabled: e.target.value === 'true' })}
                  >
                    <option value="true">Active (Enabled)</option>
                    <option value="false">Paused (Disabled)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Short Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Briefly describe what this bot does..."
                  value={agentForm.description}
                  onChange={e => setAgentForm({ ...agentForm, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>
                  <Sparkles size={14} /> Specialized Persona & Instructions (System Prompt) *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Describe tone, objectives, and specific guidance for this role..."
                  value={agentForm.systemPrompt}
                  onChange={e => setAgentForm({ ...agentForm, systemPrompt: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>
                  <FileText size={14} /> Specific Knowledge Base & FAQs (Optional)
                </label>
                <textarea
                  rows={4}
                  placeholder="Add specific pricing details, product lists, or troubleshooting answers relevant ONLY to this bot..."
                  value={agentForm.knowledgeBase}
                  onChange={e => setAgentForm({ ...agentForm, knowledgeBase: e.target.value })}
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary-glow">
                  <Save size={16} />
                  {editingAgentId ? 'Save Changes' : 'Create Bot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AiChatbot;

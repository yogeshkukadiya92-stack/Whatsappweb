import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Users,
  GitBranch,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  Loader2,
  HelpCircle,
  Edit2,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Send,
  Sparkles,
  ChevronRight,
  Layers,
  ArrowRight,
  MoveUp,
  MoveDown,
  Copy,
  Check,
  Smartphone,
} from 'lucide-react';
import {
  leadFlowsApi,
  type LeadFlow,
  type LeadEntry,
  type LeadFlowStep,
  type LeadFlowCompletionMedia,
  type Session,
} from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { resolveLeadFlowSessionId } from '../utils/leadFlowSession';
import './LeadCapture.css';

interface SimulatorMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  options?: string[];
  timestamp: string;
}

export function LeadCapture() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'flows' | 'playground' | 'leads'>('flows');

  // Flows State
  const [flows, setFlows] = useState<LeadFlow[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [togglingFlowIds, setTogglingFlowIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [editingFlowSessionId, setEditingFlowSessionId] = useState<string | null>(null);

  // Form State for Flow (Shared between Modal and Playground)
  const [flowName, setFlowName] = useState('');
  const [triggersInput, setTriggersInput] = useState('');
  const [steps, setSteps] = useState<LeadFlowStep[]>([
    { key: 'name', question: 'નમસ્તે! તમારું શુભ નામ શું છે?' },
    { key: 'city', question: 'તમે કયા શહેરમાંથી છો?' },
    { key: 'requirement', question: 'તમને કઈ સર્વિસ અથવા પ્રોડક્ટમાં રસ છે?' },
  ]);
  const [completionMessage, setCompletionMessage] = useState(
    'આભાર {{name}}! તમારી વિગતો નોંધી લેવામાં આવી છે. અમારી ટીમ ટૂંક સમયમાં તમારો સંપર્ક કરશે. 🙏',
  );
  const [completionMedia, setCompletionMedia] = useState<LeadFlowCompletionMedia[]>([]);
  const [isSavingFlow, setIsSavingFlow] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadIndex, setUploadIndex] = useState<number | null>(null);
  const hasUploadedMedia = (media: LeadFlowCompletionMedia) => Boolean(media.base64?.trim());

  // Playground Specific State
  const [activePlaygroundFlowId, setActivePlaygroundFlowId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);

  // Simulator Conversation State
  const [simMessages, setSimMessages] = useState<SimulatorMessage[]>([]);
  const [simStepIndex, setSimStepIndex] = useState<number>(-1);
  const [simCollected, setSimCollected] = useState<Record<string, string>>({});
  const [simUserInput, setSimUserInput] = useState('');
  const simChatEndRef = useRef<HTMLDivElement>(null);

  // Leads State
  const [leads, setLeads] = useState<LeadEntry[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Default Session to 'all' (all sessions)
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId('all');
    }
  }, [sessions, selectedSessionId]);

  // Load Flows
  const loadFlows = useCallback(async () => {
    if (!selectedSessionId) return;
    setLoadingFlows(true);
    try {
      const data = await leadFlowsApi.listFlows(selectedSessionId);
      setFlows(data);
    } catch (err) {
      toast.error('Failed to load flows', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFlows(false);
    }
  }, [selectedSessionId, toast]);

  // Load Leads
  const loadLeads = useCallback(async () => {
    if (!selectedSessionId) return;
    setLoadingLeads(true);
    try {
      const data = await leadFlowsApi.listLeads(selectedSessionId);
      setLeads(data);
    } catch (err) {
      toast.error('Failed to load leads', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLeads(false);
    }
  }, [selectedSessionId, toast]);

  useEffect(() => {
    if (selectedSessionId) {
      if (activeTab === 'flows' || activeTab === 'playground') loadFlows();
      else loadLeads();
    }
  }, [selectedSessionId, activeTab, loadFlows, loadLeads]);

  // Initialize flow for editing
  const setupFlowData = (flow: LeadFlow) => {
    setEditingFlowId(flow.id);
    setEditingFlowSessionId(flow.sessionId);
    setActivePlaygroundFlowId(flow.id);
    setFlowName(flow.name);
    setTriggersInput(Array.isArray(flow.triggers) ? flow.triggers.join(', ') : '');

    let currentSteps: LeadFlowStep[] = [];
    if (Array.isArray(flow.steps) && flow.steps.length > 0) {
      currentSteps = flow.steps.map((s: unknown, idx: number) => {
        if (typeof s === 'string') {
          try {
            const parsed = JSON.parse(s);
            if (parsed && typeof parsed === 'object') {
              const obj = parsed as Record<string, unknown>;
              return {
                key: (typeof obj.key === 'string' && obj.key) || `field_${idx + 1}`,
                question: (typeof obj.question === 'string' && obj.question) || (typeof obj.prompt === 'string' && obj.prompt) || s,
                options: Array.isArray(obj.options) ? obj.options.map(String) : undefined,
              };
            }
          } catch {
            return { key: `field_${idx + 1}`, question: s };
          }
        }
        if (s && typeof s === 'object') {
          const obj = s as Record<string, unknown>;
          return {
            key: (typeof obj.key === 'string' && obj.key) || (typeof obj.field === 'string' && obj.field) || `field_${idx + 1}`,
            question: (typeof obj.question === 'string' && obj.question) || (typeof obj.prompt === 'string' && obj.prompt) || '',
            options: Array.isArray(obj.options) ? obj.options.map(String) : undefined,
          };
        }
        return { key: `field_${idx + 1}`, question: '' };
      });
    }

    if (currentSteps.length === 0) {
      currentSteps = [
        { key: 'name', question: 'નમસ્તે! તમારું શુભ નામ શું છે?' },
        { key: 'city', question: 'તમે કયા શહેરમાંથી છો?' },
      ];
    }
    setSteps(currentSteps);
    setCompletionMessage(
      flow.completionMessage ||
        'આભાર {{name}}! તમારી વિગતો નોંધી લેવામાં આવી છે. અમારી ટીમ ટૂંક સમયમાં તમારો સંપર્ક કરશે. 🙏',
    );
    setCompletionMedia(Array.isArray(flow.completionMedia) ? flow.completionMedia : []);
  };

  const handleOpenCreate = () => {
    setEditingFlowId(null);
    setEditingFlowSessionId(null);
    setActivePlaygroundFlowId(null);
    setFlowName('');
    setTriggersInput('inquiry, info, hello, hi, ભાવ, કિંમત');
    setSteps([
      { key: 'name', question: 'નમસ્તે! તમારું શુભ નામ શું છે?' },
      { key: 'city', question: 'તમે કયા શહેરમાંથી છો?' },
      { key: 'requirement', question: 'તમને કઈ સર્વિસ અથવા પ્રોડક્ટમાં રસ છે?' },
    ]);
    setCompletionMessage(
      'આભાર {{name}}! તમારી વિગતો નોંધી લેવામાં આવી છે. અમારી ટીમ ટૂંક સમયમાં તમારો સંપર્ક કરશે. 🙏',
    );
    setCompletionMedia([]);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (flow: LeadFlow) => {
    setupFlowData(flow);
    setIsModalOpen(true);
  };

  // --- Interactive WhatsApp Simulator Logic ---
  const initSimulator = useCallback(() => {
    const firstTrigger = triggersInput.split(',')[0]?.trim() || 'inquiry';
    setSimStepIndex(-1);
    setSimCollected({});
    setSimMessages([
      {
        id: 'msg-0',
        sender: 'bot',
        text: `Type "${firstTrigger}" to start this interactive workflow test 👇`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  }, [triggersInput]);

  const handleLaunchPlayground = (flow?: LeadFlow) => {
    if (flow) {
      setupFlowData(flow);
    } else if (flows.length > 0 && !editingFlowId) {
      setupFlowData(flows[0]);
    } else if (!editingFlowId) {
      setEditingFlowId(null);
      setEditingFlowSessionId(null);
      setActivePlaygroundFlowId(null);
      setFlowName('New Interactive Workflow');
      setTriggersInput('inquiry, hello, hi, ભાવ');
      setSteps([
        { key: 'name', question: 'નમસ્તે! તમારું શુભ નામ શું છે?' },
        { key: 'city', question: 'તમે કયા શહેરમાંથી છો?' },
      ]);
      setCompletionMessage('આભાર {{name}}! તમારી માહિતી નોંધી લીધી છે.');
    }
    setSelectedNodeIndex(null);
    setActiveTab('playground');
    initSimulator();
  };

  const handleAddStep = (insertAfterIndex?: number) => {
    setSteps(prev => {
      const newStep: LeadFlowStep = {
        key: `field_${prev.length + 1}`,
        question: 'તમારો પ્રશ્ન અહીં લખો...',
      };
      if (insertAfterIndex !== undefined && insertAfterIndex >= 0) {
        const copy = [...prev];
        copy.splice(insertAfterIndex + 1, 0, newStep);
        return copy;
      }
      return [...prev, newStep];
    });
    if (insertAfterIndex !== undefined) {
      setSelectedNodeIndex(insertAfterIndex + 1);
    } else {
      setSelectedNodeIndex(steps.length);
    }
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) {
      toast.warning('A workflow must have at least one question step.');
      return;
    }
    setSteps(prev => prev.filter((_, i) => i !== index));
    if (selectedNodeIndex === index) {
      setSelectedNodeIndex(null);
    } else if (selectedNodeIndex !== null && selectedNodeIndex > index) {
      setSelectedNodeIndex(selectedNodeIndex - 1);
    }
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;
    setSteps(prev => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
    setSelectedNodeIndex(targetIdx);
  };

  const handleDuplicateStep = (index: number) => {
    const stepToDup = steps[index];
    const duplicated: LeadFlowStep = {
      ...stepToDup,
      key: `${stepToDup.key}_copy`,
      question: stepToDup.question,
      options: stepToDup.options ? [...stepToDup.options] : undefined,
    };
    setSteps(prev => {
      const copy = [...prev];
      copy.splice(index + 1, 0, duplicated);
      return copy;
    });
    setSelectedNodeIndex(index + 1);
    toast.info('Step duplicated');
  };

  const handleStepChange = (index: number, field: 'key' | 'question' | 'options', value: string | string[] | undefined) => {
    setSteps(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: field === 'options' ? (value === undefined ? undefined : Array.isArray(value) ? value : String(value).split('\n')) : value,
      };
      return next;
    });
  };

  const handleSaveFlow = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const cleanedSteps = steps
      .map((s, idx) => ({
        key: (s.key || `field_${idx + 1}`).trim(),
        question: (s.question || '').trim(),
        options: s.options?.map(option => option.trim()).filter(Boolean),
      }))
      .filter(s => s.question.length > 0);

    if (!flowName.trim() || cleanedSteps.length === 0) {
      toast.warning('Please provide a flow name and at least one step with a question.');
      return;
    }

    if (cleanedSteps.some(step => step.options && (step.options.length < 2 || step.options.length > 12))) {
      toast.warning('Option questions must have between 2 and 12 options.');
      return;
    }

    setIsSavingFlow(true);
    try {
      const triggers = triggersInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      const targetSessionId = resolveLeadFlowSessionId(selectedSessionId, editingFlowSessionId, sessions[0]?.id);

      if (editingFlowId) {
        await leadFlowsApi.updateFlow(targetSessionId, editingFlowId, {
          name: flowName.trim(),
          triggers,
          steps: cleanedSteps,
          completionMessage,
          completionMedia,
        });
        toast.success('Workflow updated successfully! 🚀');
      } else {
        const created = await leadFlowsApi.createFlow(targetSessionId, {
          name: flowName.trim(),
          triggers,
          steps: cleanedSteps,
          completionMessage,
          completionMedia,
        });
        setEditingFlowId(created.id);
        setActivePlaygroundFlowId(created.id);
        toast.success('New Workflow created & saved! 🚀');
      }
      setIsModalOpen(false);
      loadFlows();
    } catch (err) {
      toast.error('Error saving lead flow', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingFlow(false);
    }
  };

  const handleDeleteFlow = async (flow: LeadFlow) => {
    if (!confirm(`Are you sure you want to delete "${flow.name}"?`)) return;
    try {
      await leadFlowsApi.deleteFlow(flow.sessionId, flow.id);
      toast.info('Flow deleted');
      if (activePlaygroundFlowId === flow.id) {
        setActivePlaygroundFlowId(null);
        setEditingFlowId(null);
      }
      loadFlows();
    } catch (err) {
      toast.error('Failed to delete flow', err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleFlow = async (flow: LeadFlow) => {
    if (togglingFlowIds.has(flow.id)) return;

    const wasEnabled = flow.enabled !== false;
    const enabled = !wasEnabled;
    setTogglingFlowIds(current => new Set(current).add(flow.id));
    setFlows(current => current.map(item => (item.id === flow.id ? { ...item, enabled } : item)));

    try {
      const updatedFlow = await leadFlowsApi.updateFlow(flow.sessionId, flow.id, { enabled });
      setFlows(current => current.map(item => (item.id === flow.id ? updatedFlow : item)));
      toast.success(enabled ? 'Flow is now ON' : 'Flow is now OFF');
    } catch (err) {
      setFlows(current => current.map(item => (item.id === flow.id ? { ...item, enabled: wasEnabled } : item)));
      toast.error('Failed to change flow status', err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingFlowIds(current => {
        const next = new Set(current);
        next.delete(flow.id);
        return next;
      });
    }
  };

  const handleDeleteLead = async (lead: LeadEntry) => {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    try {
      const sessionIdToDelete = selectedSessionId === 'all' ? lead.sessionId || 'all' : selectedSessionId;
      await leadFlowsApi.deleteLead(sessionIdToDelete, lead.id);
      toast.info('Lead deleted');
      loadLeads();
    } catch (err) {
      toast.error('Failed to delete lead', err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportCsv = () => {
    window.open(leadFlowsApi.exportCsvUrl(selectedSessionId), '_blank');
  };

  const handleSimSend = (textToSend?: string) => {
    const text = (textToSend || simUserInput).trim();
    if (!text) return;
    setSimUserInput('');

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // User message
    const userMsg: SimulatorMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: timeStr,
    };

    setSimMessages(prev => [...prev, userMsg]);

    setTimeout(() => {
      // If at start (idle)
      if (simStepIndex === -1) {
        const triggers = triggersInput
          .toLowerCase()
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
        const match = triggers.length === 0 || triggers.some(t => text.toLowerCase().includes(t));

        if (match && steps.length > 0) {
          const firstStep = steps[0];
          setSimStepIndex(0);
          setSimMessages(prev => [
            ...prev,
            {
              id: `bot-${Date.now()}`,
              sender: 'bot',
              text: firstStep.question,
              options: firstStep.options,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        } else {
          setSimMessages(prev => [
            ...prev,
            {
              id: `bot-${Date.now()}`,
              sender: 'bot',
              text: `Please type one of the configured keywords: "${triggersInput}"`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
        return;
      }

      // If in progress
      const currentStep = steps[simStepIndex];
      if (currentStep) {
        const nextCollected = { ...simCollected, [currentStep.key]: text };
        setSimCollected(nextCollected);

        const nextIdx = simStepIndex + 1;
        if (nextIdx < steps.length) {
          const nextStep = steps[nextIdx];
          setSimStepIndex(nextIdx);
          setSimMessages(prev => [
            ...prev,
            {
              id: `bot-${Date.now()}`,
              sender: 'bot',
              text: nextStep.question,
              options: nextStep.options,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        } else {
          // Finished flow
          setSimStepIndex(steps.length);
          let finalMsg = completionMessage;
          for (const [k, v] of Object.entries(nextCollected)) {
            finalMsg = finalMsg.replace(new RegExp(`{{${k}}}`, 'g'), v);
          }
          setSimMessages(prev => [
            ...prev,
            {
              id: `bot-${Date.now()}`,
              sender: 'bot',
              text: finalMsg,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      }
    }, 400);
  };

  useEffect(() => {
    simChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [simMessages]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const chatMatch = l.chatId?.toLowerCase().includes(term);
      const dataMatch =
        l.collectedData &&
        Object.values(l.collectedData).some(v => (v != null ? String(v).toLowerCase().includes(term) : false));
      return chatMatch || dataMatch;
    });
  }, [leads, searchTerm]);

  // Selected step details for quick node inspector
  const activeSelectedStep = selectedNodeIndex !== null ? steps[selectedNodeIndex] : null;

  return (
    <div className={`lead-capture-page ${isFullscreen ? 'playground-fullscreen-active' : ''}`}>
      {!isFullscreen && (
        <PageHeader
          title="Interactive WhatsApp Workflows & Leads"
          subtitle="Build visual step-by-step bots and automated lead collection funnels"
        />
      )}

      {/* Top Navigation & Controls */}
      <div className="lead-top-controls">
        <div className="session-select-wrapper">
          <label htmlFor="lead-session-select">Session:</label>
          {sessionsLoading ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <select
              id="lead-session-select"
              value={selectedSessionId}
              onChange={e => setSelectedSessionId(e.target.value)}
              className="session-select"
            >
              <option value="all">🌟 All Sessions (Global Scope)</option>
              {sessions.map((s: Session) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="lead-tabs">
          <button
            className={`tab-btn ${activeTab === 'flows' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('flows');
              if (isFullscreen) setIsFullscreen(false);
            }}
          >
            <Layers size={16} />
            Workflows ({flows.length})
          </button>
          <button
            className={`tab-btn playground-tab-pill ${activeTab === 'playground' ? 'active' : ''}`}
            onClick={() => handleLaunchPlayground()}
          >
            <Sparkles size={16} className="sparkle-icon" />
            Visual Studio
          </button>
          <button
            className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('leads');
              if (isFullscreen) setIsFullscreen(false);
            }}
          >
            <Users size={16} />
            Captured Leads ({leads.length})
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 1. FLOWS LIST TAB */}
      {/* ======================================================== */}
      {activeTab === 'flows' && (
        <div className="flows-container">
          <div className="tab-action-bar">
            <div>
              <h3 className="section-title">Active Workflows</h3>
              <p className="section-subtitle">Visual conversation funnels triggered by customer keywords</p>
            </div>
            <div className="action-buttons-group">
              <button className="btn-secondary" onClick={() => handleLaunchPlayground()}>
                <Sparkles size={16} /> Open Visual Studio
              </button>
              <button className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={16} /> Quick Create Flow
              </button>
            </div>
          </div>

          {loadingFlows ? (
            <div className="loading-state">
              <Loader2 className="animate-spin" size={24} /> Loading flows...
            </div>
          ) : flows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-circle">
                <GitBranch size={40} className="empty-icon" />
              </div>
              <h4>No Workflow Funnels created yet</h4>
              <p>
                Design interactive question & answer workflows in our visual playground.
              </p>
              <div className="empty-actions">
                <button className="btn-primary" onClick={() => handleLaunchPlayground()}>
                  <Sparkles size={16} /> Open Visual Studio
                </button>
              </div>
            </div>
          ) : (
            <div className="flows-grid">
              {flows.map(flow => {
                const flowEnabled = flow.enabled !== false;
                const isToggling = togglingFlowIds.has(flow.id);

                return (
                  <div key={flow.id} className={`flow-card ${flowEnabled ? '' : 'flow-card-disabled'}`}>
                    <div className="flow-card-header">
                      <div className="flow-card-title-group">
                        <span className="flow-badge-icon">⚡</span>
                        <h4>{flow.name}</h4>
                      </div>
                      <div className="flow-card-actions">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={flowEnabled}
                          aria-label={`${flowEnabled ? 'Turn off' : 'Turn on'} ${flow.name}`}
                          className={`flow-toggle ${flowEnabled ? 'is-on' : 'is-off'}`}
                          onClick={() => handleToggleFlow(flow)}
                          disabled={isToggling}
                        >
                          <span className="flow-toggle-label">{isToggling ? '...' : flowEnabled ? 'ON' : 'OFF'}</span>
                          <span className="flow-toggle-track" aria-hidden="true">
                            <span className="flow-toggle-thumb" />
                          </span>
                        </button>
                        <button
                          className="btn-icon-studio"
                          title="Open in Visual Studio"
                          onClick={() => handleLaunchPlayground(flow)}
                        >
                          <Sparkles size={15} />
                        </button>
                        <button className="btn-icon-edit" title="Edit flow" onClick={() => handleOpenEdit(flow)}>
                          <Edit2 size={15} />
                        </button>
                        <button className="btn-icon-danger" title="Delete flow" onClick={() => handleDeleteFlow(flow)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="flow-triggers">
                      <span className="label">Keywords:</span>
                      <div className="trigger-tags">
                        {(flow.triggers || []).map((t, idx) => (
                          <span key={idx} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Compact Pipeline Node Breadcrumb */}
                    <div className="flow-mini-pipeline">
                      <span className="mini-pipeline-node trigger">⚡ Start</span>
                      <ChevronRight size={14} className="crumb-arrow" />
                      {(flow.steps || []).slice(0, 3).map((step: LeadFlowStep, idx: number) => {
                        const k = typeof step === 'object' && step?.key ? step.key : `step_${idx + 1}`;
                        return (
                          <span key={idx} className="mini-pipeline-node step">
                            {k}
                          </span>
                        );
                      })}
                      {(flow.steps?.length || 0) > 3 && (
                        <span className="mini-pipeline-node more">+{flow.steps!.length - 3}</span>
                      )}
                      <ChevronRight size={14} className="crumb-arrow" />
                      <span className="mini-pipeline-node finish">🎉 Done</span>
                    </div>

                    <div className="flow-completion">
                      <span className="label">End Response:</span>
                      <p>{flow.completionMessage}</p>
                    </div>

                    <div className="flow-card-footer">
                      <button
                        className="btn-open-canvas-link"
                        onClick={() => handleLaunchPlayground(flow)}
                      >
                        Launch Interactive Studio <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. VISUAL WORKFLOW PLAYGROUND CANVAS */}
      {/* ======================================================== */}
      {activeTab === 'playground' && (
        <div className={`playground-workspace ${isFullscreen ? 'is-fullscreen' : ''}`}>
          {/* Studio Top Control Ribbon */}
          <div className="playground-toolbar">
            <div className="toolbar-left">
              <div className="flow-meta-inputs">
                <input
                  type="text"
                  className="playground-flow-title"
                  placeholder="Untitled Workflow"
                  value={flowName}
                  onChange={e => setFlowName(e.target.value)}
                />
                <div className="triggers-pill-wrapper">
                  <span className="trigger-label">⚡ Keywords:</span>
                  <input
                    type="text"
                    className="playground-triggers-input"
                    placeholder="e.g. inquiry, hi, hello, ભાવ"
                    value={triggersInput}
                    onChange={e => setTriggersInput(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="toolbar-center">
              <div className="zoom-controls">
                <button
                  type="button"
                  className="btn-toolbar-tool"
                  title="Zoom Out"
                  onClick={() => setZoomLevel(prev => Math.max(0.6, prev - 0.1))}
                >
                  <ZoomOut size={16} />
                </button>
                <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>
                <button
                  type="button"
                  className="btn-toolbar-tool"
                  title="Zoom In"
                  onClick={() => setZoomLevel(prev => Math.min(1.4, prev + 0.1))}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  className="btn-toolbar-tool"
                  title="Reset Zoom"
                  onClick={() => setZoomLevel(1)}
                >
                  100%
                </button>
              </div>
            </div>

            <div className="toolbar-right">
              <button
                type="button"
                className={`btn-toolbar-simulator ${showSimulator ? 'active' : ''}`}
                onClick={() => {
                  setShowSimulator(!showSimulator);
                  if (!showSimulator) initSimulator();
                }}
              >
                <Smartphone size={16} />
                {showSimulator ? 'Hide Simulator' : 'Test in WhatsApp'}
              </button>

              <button
                type="button"
                className="btn-toolbar-fullscreen"
                title={isFullscreen ? 'Exit Full Screen' : 'Full Screen Playground'}
                onClick={() => setIsFullscreen(!isFullscreen)}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>

              <button
                type="button"
                className="btn-primary btn-save-studio"
                onClick={() => handleSaveFlow()}
                disabled={isSavingFlow}
              >
                {isSavingFlow ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                Save Workflow
              </button>
            </div>
          </div>

          {/* Playground Viewport with Infinite Dot Grid Canvas */}
          <div className="playground-canvas-container">
            <div
              className="playground-canvas-viewport"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top center',
              }}
            >
              <div className="nodes-horizontal-flow">
                {/* 1. START / TRIGGER NODE */}
                <div className="workflow-node trigger-node">
                  <div className="node-port port-out" />
                  <div className="node-header">
                    <span className="node-icon">⚡</span>
                    <span className="node-title">Start Trigger</span>
                  </div>
                  <div className="node-body">
                    <p className="node-subtext">Keywords Received</p>
                    <div className="node-chips-cloud">
                      {triggersInput.split(',').map((t, idx) => (
                        <span key={idx} className="chip chip-trigger">
                          {t.trim() || 'inquiry'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Connector Arrow */}
                <div className="flow-connector-bridge">
                  <svg className="connector-svg" width="60" height="30">
                    <line x1="0" y1="15" x2="55" y2="15" className="connector-line" />
                    <polygon points="52,10 60,15 52,20" className="connector-arrow" />
                  </svg>
                  <button
                    type="button"
                    className="btn-insert-node-pill"
                    title="Insert Question here"
                    onClick={() => handleAddStep(-1)}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* 2. QUESTION / INPUT STEPS */}
                {steps.map((step, idx) => {
                  const isSelected = selectedNodeIndex === idx;
                  const hasOptions = step.options && step.options.length > 0;

                  return (
                    <div key={idx} className="node-with-connector-group">
                      <div
                        className={`workflow-node step-node ${isSelected ? 'is-active-node' : ''}`}
                        onClick={() => setSelectedNodeIndex(idx)}
                      >
                        <div className="node-port port-in" />
                        <div className="node-port port-out" />

                        <div className="node-header">
                          <div className="node-title-group">
                            <span className="node-icon">{hasOptions ? '🔘' : '💬'}</span>
                            <span className="node-step-badge">Step {idx + 1}</span>
                            <span className="node-var-tag">`{step.key}`</span>
                          </div>
                          <div className="node-micro-actions" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className="micro-btn"
                              title="Move Left"
                              disabled={idx === 0}
                              onClick={() => handleMoveStep(idx, 'up')}
                            >
                              <MoveUp size={12} style={{ transform: 'rotate(-90deg)' }} />
                            </button>
                            <button
                              type="button"
                              className="micro-btn"
                              title="Move Right"
                              disabled={idx === steps.length - 1}
                              onClick={() => handleMoveStep(idx, 'down')}
                            >
                              <MoveDown size={12} style={{ transform: 'rotate(-90deg)' }} />
                            </button>
                            <button
                              type="button"
                              className="micro-btn"
                              title="Duplicate Step"
                              onClick={() => handleDuplicateStep(idx)}
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              type="button"
                              className="micro-btn danger"
                              title="Delete Step"
                              onClick={() => handleRemoveStep(idx)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="node-body">
                          <p className="node-question-text" title={step.question}>
                            {step.question || <em>(Empty Question)</em>}
                          </p>
                          {hasOptions && (
                            <div className="node-options-preview">
                              {step.options!.slice(0, 3).map((opt, oIdx) => (
                                <span key={oIdx} className="mini-opt-pill">
                                  {opt}
                                </span>
                              ))}
                              {step.options!.length > 3 && (
                                <span className="mini-opt-pill more">+{step.options!.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="node-footer">
                          <span className="node-mode-indicator">
                            {hasOptions ? 'Single Choice' : 'Customer Free Text'}
                          </span>
                        </div>
                      </div>

                      {/* Connector to Next Step */}
                      <div className="flow-connector-bridge">
                        <svg className="connector-svg" width="60" height="30">
                          <line x1="0" y1="15" x2="55" y2="15" className="connector-line" />
                          <polygon points="52,10 60,15 52,20" className="connector-arrow" />
                        </svg>
                        <button
                          type="button"
                          className="btn-insert-node-pill"
                          title="Insert Question here"
                          onClick={() => handleAddStep(idx)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* 3. COMPLETION NODE */}
                <div className="workflow-node complete-node">
                  <div className="node-port port-in" />
                  <div className="node-header">
                    <span className="node-icon">🎉</span>
                    <span className="node-title">Complete & Save</span>
                  </div>
                  <div className="node-body">
                    <p className="node-subtext">Thank You Message</p>
                    <div className="node-completion-preview">
                      <p>{completionMessage}</p>
                    </div>
                  </div>
                </div>

                {/* Add Step Button Node */}
                <button
                  type="button"
                  className="workflow-node add-node-placeholder"
                  onClick={() => handleAddStep()}
                >
                  <Plus size={20} />
                  <span>Add Question Step</span>
                </button>
              </div>
            </div>

            {/* Floating Node Inspector Dock */}
            {activeSelectedStep && selectedNodeIndex !== null && (
              <div className="node-inspector-drawer">
                <div className="inspector-header">
                  <div className="inspector-title">
                    <Sparkles size={16} />
                    <h4>Step {selectedNodeIndex + 1} Inspector</h4>
                  </div>
                  <button
                    type="button"
                    className="btn-close-inspector"
                    onClick={() => setSelectedNodeIndex(null)}
                  >
                    ✕
                  </button>
                </div>

                <div className="inspector-body">
                  <div className="form-group">
                    <label>Variable Name / Storage Key</label>
                    <input
                      type="text"
                      className="inspector-input"
                      placeholder="e.g. name, city, service"
                      value={activeSelectedStep.key}
                      onChange={e => handleStepChange(selectedNodeIndex, 'key', e.target.value)}
                    />
                    <small className="form-hint">
                      Saved as <code>{`{${activeSelectedStep.key || 'key'}}`}</code>
                    </small>
                  </div>

                  <div className="form-group">
                    <label>Question Prompt</label>
                    <textarea
                      rows={3}
                      className="inspector-textarea"
                      placeholder="e.g. તમારું શુભ નામ શું છે?"
                      value={activeSelectedStep.question}
                      onChange={e => handleStepChange(selectedNodeIndex, 'question', e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Customer Response Mode</label>
                    <select
                      className="inspector-select"
                      value={activeSelectedStep.options ? 'options' : 'text'}
                      onChange={e => {
                        const isOptions = e.target.value === 'options';
                        handleStepChange(
                          selectedNodeIndex,
                          'options',
                          isOptions ? ['Option 1', 'Option 2'] : undefined,
                        );
                      }}
                    >
                      <option value="text">Free Text (Customer types response)</option>
                      <option value="options">Selection Buttons (Clickable Choices)</option>
                    </select>
                  </div>

                  {activeSelectedStep.options && (
                    <div className="form-group">
                      <label>Choice Options (one per line)</label>
                      <textarea
                        rows={4}
                        className="inspector-textarea"
                        placeholder={'Option 1\nOption 2\nOption 3'}
                        value={activeSelectedStep.options.join('\n')}
                        onChange={e => handleStepChange(selectedNodeIndex, 'options', e.target.value.split('\n'))}
                      />
                      <small className="form-hint">WhatsApp allows 2 to 10 clickable options.</small>
                    </div>
                  )}

                  <div className="inspector-actions">
                    <button
                      type="button"
                      className="btn-danger-outline"
                      onClick={() => handleRemoveStep(selectedNodeIndex)}
                    >
                      <Trash2 size={14} /> Remove Step
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Live WhatsApp Interactive Simulator Panel */}
            {showSimulator && (
              <div className="whatsapp-simulator-panel">
                <div className="simulator-phone-frame">
                  {/* Phone Notch / Top Bar */}
                  <div className="phone-top-bar">
                    <div className="phone-camera-dot" />
                  </div>

                  {/* WhatsApp Header */}
                  <div className="phone-wa-header">
                    <div className="phone-wa-avatar">🤖</div>
                    <div className="phone-wa-info">
                      <span className="phone-wa-name">Waply Bot Simulator</span>
                      <span className="phone-wa-status">online (live test)</span>
                    </div>
                    <button
                      type="button"
                      className="btn-phone-reset"
                      title="Reset Simulator"
                      onClick={initSimulator}
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-phone-close"
                      onClick={() => setShowSimulator(false)}
                    >
                      ✕
                    </button>
                  </div>

                  {/* WhatsApp Messages Scroll Body */}
                  <div className="phone-wa-chat-body">
                    {simMessages.map(msg => (
                      <div key={msg.id} className={`wa-bubble ${msg.sender === 'bot' ? 'bot-bubble' : 'user-bubble'}`}>
                        <p className="wa-bubble-text">{msg.text}</p>
                        {msg.options && (
                          <div className="wa-bubble-options">
                            {msg.options.map((opt, oIdx) => (
                              <button
                                key={oIdx}
                                type="button"
                                className="wa-option-btn"
                                onClick={() => handleSimSend(opt)}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                        <span className="wa-bubble-time">{msg.timestamp}</span>
                      </div>
                    ))}
                    <div ref={simChatEndRef} />
                  </div>

                  {/* WhatsApp Input Bar */}
                  <div className="phone-wa-input-bar">
                    <input
                      type="text"
                      className="phone-wa-input"
                      placeholder="Type a message..."
                      value={simUserInput}
                      onChange={e => setSimUserInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSimSend();
                      }}
                    />
                    <button
                      type="button"
                      className="phone-wa-send-btn"
                      onClick={() => handleSimSend()}
                      disabled={!simUserInput.trim()}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. CAPTURED LEADS TAB */}
      {/* ======================================================== */}
      {activeTab === 'leads' && (
        <div className="leads-container">
          <div className="tab-action-bar">
            <input
              type="text"
              placeholder="Search by phone, name, city..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button className="btn-secondary" onClick={handleExportCsv} disabled={leads.length === 0}>
              <Download size={16} /> Export to Excel / CSV
            </button>
          </div>

          {loadingLeads ? (
            <div className="loading-state">
              <Loader2 className="animate-spin" size={24} /> Loading leads...
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon-circle">
                <Users size={40} className="empty-icon" />
              </div>
              <h4>No leads captured yet</h4>
              <p>
                When customers trigger your workflows on WhatsApp, their responses appear here in real-time.
              </p>
            </div>
          ) : (
            <div className="leads-table-wrapper">
              <table className="leads-table">
                <thead>
                  <tr>
                    {selectedSessionId === 'all' && <th>Session</th>}
                    <th>Customer (WhatsApp)</th>
                    <th>Status</th>
                    <th>Collected Information</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map(lead => {
                    const sessionObj = sessions.find(s => s.id === lead.sessionId);
                    return (
                      <tr key={lead.id}>
                        {selectedSessionId === 'all' && (
                          <td>
                            <span
                              className="badge-secondary"
                              style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px' }}
                            >
                              {sessionObj?.name || lead.sessionId}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className="lead-phone">{lead.chatId.replace('@c.us', '')}</span>
                        </td>
                        <td>
                          {lead.status === 'completed' ? (
                            <span className="badge-status-completed">
                              <CheckCircle2 size={12} /> Completed
                            </span>
                          ) : (
                            <span className="badge-status-progress">
                              <Clock size={12} /> In Progress
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="lead-data-pills">
                            {lead.collectedData &&
                              Object.entries(lead.collectedData).map(([k, v]) => (
                                <div key={k} className="data-pill">
                                  <strong>{k}:</strong> {v}
                                </div>
                              ))}
                          </div>
                        </td>
                        <td className="lead-date">
                          {lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '-'}
                        </td>
                        <td>
                          <button
                            className="btn-icon-danger"
                            title="Delete lead"
                            onClick={() => handleDeleteLead(lead)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. MODAL FOR CREATING / EDITING FLOW (STANDALONE) */}
      {/* ======================================================== */}
      {isModalOpen && (
        <Modal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingFlowId ? 'Edit Workflow' : 'Create Interactive Workflow'}
        >
          <form onSubmit={handleSaveFlow} className="flow-modal-form">
            <div className="form-group">
              <label>Workflow Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Website Inquiry / Product Booking"
                value={flowName}
                onChange={e => setFlowName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Trigger Keywords (comma-separated)</label>
              <input
                type="text"
                required
                placeholder="e.g. inquiry, hi, hello, demo, ભાવ, કિંમત"
                value={triggersInput}
                onChange={e => setTriggersInput(e.target.value)}
              />
              <small className="form-hint">
                When a customer sends any of these words, this interactive workflow begins automatically.
              </small>
            </div>

            <div className="form-group">
              <div className="steps-header">
                <label>Question Sequence (Steps)</label>
                <button type="button" className="btn-add-step" onClick={() => handleAddStep()}>
                  <Plus size={14} /> Add Question
                </button>
              </div>

              <div className="steps-builder-list">
                {steps.map((step, idx) => (
                  <div key={idx} className="step-builder-row">
                    <span className="step-num">{idx + 1}</span>
                    <div className="step-fields">
                      <div className="step-main-fields">
                        <input
                          type="text"
                          className="step-key"
                          placeholder="Field (e.g. name)"
                          value={step.key}
                          onChange={e => handleStepChange(idx, 'key', e.target.value)}
                          required
                        />
                        <input
                          type="text"
                          className="step-question"
                          placeholder="Question to ask (e.g. તમારું નામ શું છે?)"
                          value={step.question}
                          onChange={e => handleStepChange(idx, 'question', e.target.value)}
                          required
                        />
                      </div>
                      <div className="step-answer-type">
                        <label htmlFor={`answer-type-${idx}`}>Answer Type</label>
                        <select
                          id={`answer-type-${idx}`}
                          value={step.options ? 'options' : 'text'}
                          onChange={e => {
                            setSteps(prev =>
                              prev.map((item, itemIndex) =>
                                itemIndex === idx
                                  ? { ...item, options: e.target.value === 'options' ? ['Option 1', 'Option 2'] : undefined }
                                  : item,
                              ),
                            );
                          }}
                        >
                          <option value="text">Customer types</option>
                          <option value="options">Customer selects an option</option>
                        </select>
                      </div>
                      {step.options && (
                        <div className="step-options-editor">
                          <label htmlFor={`options-${idx}`}>Options (one per line)</label>
                          <textarea
                            id={`options-${idx}`}
                            rows={Math.max(2, step.options.length)}
                            placeholder={'Option 1\nOption 2'}
                            value={step.options.join('\n')}
                            onChange={e => handleStepChange(idx, 'options', e.target.value)}
                            required
                          />
                          <small className="form-hint">
                            Add 2–12 choices. Customer will tap one option in WhatsApp.
                          </small>
                        </div>
                      )}
                    </div>
                    {steps.length > 1 && (
                      <button type="button" className="btn-icon-danger" onClick={() => handleRemoveStep(idx)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>
                Completion Message{' '}
                <span title="Use {{field}} to interpolate answers">
                  <HelpCircle size={12} />
                </span>
              </label>
              <textarea
                rows={3}
                required
                value={completionMessage}
                onChange={e => setCompletionMessage(e.target.value)}
                placeholder="e.g. આભાર {{name}}! તમારી વિગતો મળી ગઈ છે."
              />
              <small className="form-hint">
                Personalize using variables, e.g. <code>{'{{name}}'}</code>, <code>{'{{city}}'}</code>.
              </small>
            </div>

            <div className="form-group completion-media-editor">
              <label>
                After completion: attachments <span className="form-hint-inline">(optional)</span>
              </label>
              <small className="form-hint">
                Send an image, document, audio or video after the greeting. Use a public URL or upload a file directly.
              </small>
              {completionMedia.map((media, index) => (
                <div className="completion-media-row" key={`${media.type}-${index}`}>
                  <select
                    value={media.type}
                    onChange={e =>
                      setCompletionMedia(items =>
                        items.map((item, i) =>
                          i === index ? { ...item, type: e.target.value as LeadFlowCompletionMedia['type'] } : item,
                        ),
                      )
                    }
                  >
                    <option value="image">Image</option>
                    <option value="document">Document</option>
                    <option value="audio">Audio</option>
                    <option value="video">Video</option>
                  </select>
                  <input
                    value={
                      hasUploadedMedia(media) ? `Uploaded: ${media.filename || media.caption || 'file'}` : media.url
                    }
                    placeholder="https://example.com/file"
                    onChange={e =>
                      setCompletionMedia(items =>
                        items.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                url: e.target.value,
                                base64: undefined,
                                mimetype: undefined,
                                filename: undefined,
                              }
                            : item,
                        ),
                      )
                    }
                    readOnly={hasUploadedMedia(media)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setUploadIndex(index);
                      uploadInputRef.current?.click();
                    }}
                  >
                    Upload
                  </button>
                  <input
                    value={media.caption || ''}
                    placeholder="Caption (optional)"
                    onChange={e =>
                      setCompletionMedia(items =>
                        items.map((item, i) => (i === index ? { ...item, caption: e.target.value } : item)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => setCompletionMedia(items => items.filter((_, i) => i !== index))}
                    aria-label="Remove attachment"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <input
                ref={uploadInputRef}
                type="file"
                hidden
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,audio/*,video/*"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file || uploadIndex === null) return;
                  if (file.size > 8 * 1024 * 1024) {
                    toast.error('File is too large', 'Please choose a file smaller than 8 MB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const data = String(reader.result);
                    setCompletionMedia(items =>
                      items.map((item, i) =>
                        i === uploadIndex
                          ? {
                              ...item,
                              url: '',
                              base64: data,
                              mimetype: file.type || 'application/octet-stream',
                              filename: file.name,
                              type: file.type.startsWith('image/')
                                ? 'image'
                                : file.type.startsWith('audio/')
                                  ? 'audio'
                                  : file.type.startsWith('video/')
                                    ? 'video'
                                    : 'document',
                              caption: item.caption || file.name,
                            }
                          : item,
                      ),
                    );
                  };
                  reader.readAsDataURL(file);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                className="btn-secondary btn-add-media"
                onClick={() => setCompletionMedia(items => [...items, { type: 'image', url: '' }])}
              >
                <Plus size={15} /> Add attachment
              </button>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={isSavingFlow}>
                {isSavingFlow ? <Loader2 className="animate-spin" size={16} /> : 'Save Workflow'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default LeadCapture;


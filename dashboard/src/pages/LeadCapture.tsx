import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { leadFlowsApi, type LeadFlow, type LeadEntry, type LeadFlowStep, type Session } from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { resolveLeadFlowSessionId } from '../utils/leadFlowSession';
import './LeadCapture.css';

export function LeadCapture() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'flows' | 'leads'>('flows');

  // Flows State
  const [flows, setFlows] = useState<LeadFlow[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [togglingFlowIds, setTogglingFlowIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [editingFlowSessionId, setEditingFlowSessionId] = useState<string | null>(null);

  // Form State for Flow
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
  const [isSavingFlow, setIsSavingFlow] = useState(false);

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
      if (activeTab === 'flows') loadFlows();
      else loadLeads();
    }
  }, [selectedSessionId, activeTab, loadFlows, loadLeads]);

  const handleOpenCreate = () => {
    setEditingFlowId(null);
    setEditingFlowSessionId(null);
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
    setIsModalOpen(true);
  };

  const handleOpenEdit = (flow: LeadFlow) => {
    setEditingFlowId(flow.id);
    setEditingFlowSessionId(flow.sessionId);
    setFlowName(flow.name);
    setTriggersInput(Array.isArray(flow.triggers) ? flow.triggers.join(', ') : '');

    let currentSteps: LeadFlowStep[] = [];
    if (Array.isArray(flow.steps) && flow.steps.length > 0) {
      currentSteps = flow.steps.map((s: any, idx: number) => {
        if (typeof s === 'string') {
          try {
            const parsed = JSON.parse(s);
            if (parsed && typeof parsed === 'object') {
              return {
                key: parsed.key || `field_${idx + 1}`,
                question: parsed.question || parsed.prompt || s,
                options: Array.isArray(parsed.options) ? parsed.options : undefined,
              };
            }
          } catch {
            return { key: `field_${idx + 1}`, question: s };
          }
        }
        return {
          key: s?.key || s?.field || `field_${idx + 1}`,
          question: s?.question || s?.prompt || '',
          options: Array.isArray(s?.options) ? s.options : undefined,
        };
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
    setIsModalOpen(true);
  };

  const handleAddStep = () => {
    setSteps(prev => [...prev, { key: `field_${prev.length + 1}`, question: '' }]);
  };

  const handleRemoveStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, field: 'key' | 'question' | 'options', value: string) => {
    setSteps(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: field === 'options' ? value.split('\n') : value,
      };
      return next;
    });
  };

  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
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
        });
        toast.success('Lead Flow updated successfully!');
      } else {
        await leadFlowsApi.createFlow(targetSessionId, {
          name: flowName.trim(),
          triggers,
          steps: cleanedSteps,
          completionMessage,
        });
        toast.success('New Lead Flow created successfully!');
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
    if (!confirm('Are you sure you want to delete this lead flow?')) return;
    try {
      await leadFlowsApi.deleteFlow(flow.sessionId, flow.id);
      toast.info('Flow deleted');
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

  const handleDeleteLead = async (id: string) => {
    try {
      await leadFlowsApi.deleteLead(selectedSessionId, id);
      toast.info('Lead deleted');
      loadLeads();
    } catch (err) {
      toast.error('Failed to delete lead', err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportCsv = () => {
    window.open(leadFlowsApi.exportCsvUrl(selectedSessionId), '_blank');
  };

  const filteredLeads = leads.filter(l => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const chatMatch = l.chatId.toLowerCase().includes(term);
    const dataMatch = l.collectedData && Object.values(l.collectedData).some(v => v.toLowerCase().includes(term));
    return chatMatch || dataMatch;
  });

  return (
    <div className="lead-capture-page">
      <PageHeader
        title="Interactive Lead Capture Flows"
        subtitle="Automated step-by-step customer questionnaire and lead collection"
      />

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
              <option value="all">🌟 All Sessions (બધા જ સેશન - Global)</option>
              {sessions.map((s: Session) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="lead-tabs">
          <button className={`tab-btn ${activeTab === 'flows' ? 'active' : ''}`} onClick={() => setActiveTab('flows')}>
            <GitBranch size={16} />
            Question Flows
          </button>
          <button className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`} onClick={() => setActiveTab('leads')}>
            <Users size={16} />
            Captured Leads ({leads.length})
          </button>
        </div>
      </div>

      {/* Flows Tab */}
      {activeTab === 'flows' && (
        <div className="flows-container">
          <div className="tab-action-bar">
            <h3>Active Question Flows</h3>
            <button className="btn-primary" onClick={handleOpenCreate}>
              <Plus size={16} /> Create New Flow
            </button>
          </div>

          {loadingFlows ? (
            <div className="loading-state">
              <Loader2 className="animate-spin" size={24} /> Loading flows...
            </div>
          ) : flows.length === 0 ? (
            <div className="empty-state">
              <GitBranch size={48} className="empty-icon" />
              <h4>No Lead Flows configured yet</h4>
              <p>
                Create your first step-by-step flow to collect names, phone numbers, and requirements automatically.
              </p>
              <button className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={16} /> Create Flow
              </button>
            </div>
          ) : (
            <div className="flows-grid">
              {flows.map(flow => {
                const flowEnabled = flow.enabled !== false;
                const isToggling = togglingFlowIds.has(flow.id);

                return (
                  <div key={flow.id} className={`flow-card ${flowEnabled ? '' : 'flow-card-disabled'}`}>
                    <div className="flow-card-header">
                      <h4>{flow.name}</h4>
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
                          <span className="flow-toggle-label">{isToggling ? 'WAIT' : flowEnabled ? 'ON' : 'OFF'}</span>
                          <span className="flow-toggle-track" aria-hidden="true">
                            <span className="flow-toggle-thumb" />
                          </span>
                        </button>
                        <button className="btn-icon-edit" title="Edit flow" onClick={() => handleOpenEdit(flow)}>
                          <Edit2 size={16} />
                        </button>
                        <button className="btn-icon-danger" title="Delete flow" onClick={() => handleDeleteFlow(flow)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="flow-triggers">
                      <span className="label">Triggers:</span>
                      <div className="trigger-tags">
                        {(flow.triggers || []).map((t, idx) => (
                          <span key={idx} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flow-steps-preview">
                      <span className="label">Steps ({flow.steps?.length || 0}):</span>
                      <ol>
                        {(flow.steps || []).map((step: any, idx: number) => {
                          const stepKey = typeof step === 'object' && step?.key ? step.key : `step_${idx + 1}`;
                          const stepQuestion =
                            typeof step === 'object' && step?.question
                              ? step.question
                              : typeof step === 'string'
                                ? step
                                : '';
                          return (
                            <li key={idx}>
                              <strong>[{stepKey}]:</strong>{' '}
                              {stepQuestion || <em style={{ opacity: 0.5 }}>(Empty question - click Edit to set)</em>}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    <div className="flow-completion">
                      <span className="label">On Complete:</span>
                      <p>{flow.completionMessage}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Leads Tab */}
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
              <Users size={48} className="empty-icon" />
              <h4>No leads captured yet</h4>
              <p>
                When customers trigger your question flows on WhatsApp, their answers will appear here in real-time.
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
                            onClick={() => handleDeleteLead(lead.id)}
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

      {/* Modal for Creating / Editing Flow */}
      {isModalOpen && (
        <Modal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingFlowId ? 'Edit Lead Flow' : 'Create Step-by-Step Lead Flow'}
        >
          <form onSubmit={handleSaveFlow} className="flow-modal-form">
            <div className="form-group">
              <label>Flow Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Website Inquiry / Property Booking"
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
                When customer types any of these words, this interactive flow starts automatically.
              </small>
            </div>

            <div className="form-group">
              <div className="steps-header">
                <label>Question Sequence (Steps)</label>
                <button type="button" className="btn-add-step" onClick={handleAddStep}>
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
                        <label htmlFor={`answer-type-${idx}`}>Answer</label>
                        <select
                          id={`answer-type-${idx}`}
                          value={step.options ? 'options' : 'text'}
                          onChange={e => {
                            setSteps(prev =>
                              prev.map((item, itemIndex) =>
                                itemIndex === idx
                                  ? { ...item, options: e.target.value === 'options' ? ['', ''] : undefined }
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
                You can personalize with variables, e.g. <code>{'{{name}}'}</code>, <code>{'{{city}}'}</code>.
              </small>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={isSavingFlow}>
                {isSavingFlow ? <Loader2 className="animate-spin" size={16} /> : 'Save Flow'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default LeadCapture;

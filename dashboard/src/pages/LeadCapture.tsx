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
} from 'lucide-react';
import {
  leadFlowsApi,
  type LeadFlow,
  type LeadEntry,
  type LeadFlowStep,
  type Session,
} from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import './LeadCapture.css';

export function LeadCapture() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'flows' | 'leads'>('flows');

  // Flows State
  const [flows, setFlows] = useState<LeadFlow[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);

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

  // Default Session
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id);
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

  const handleAddStep = () => {
    setSteps(prev => [...prev, { key: `field_${prev.length + 1}`, question: '' }]);
  };

  const handleRemoveStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, field: 'key' | 'question', value: string) => {
    setSteps(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowName.trim() || steps.length === 0) {
      toast.warning('Please provide a flow name and at least one step.');
      return;
    }

    setIsSavingFlow(true);
    try {
      const triggers = triggersInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      if (editingFlowId) {
        await leadFlowsApi.updateFlow(selectedSessionId, editingFlowId, {
          name: flowName.trim(),
          triggers,
          steps,
          completionMessage,
        });
        toast.success('Lead Flow updated successfully!');
      } else {
        await leadFlowsApi.createFlow(selectedSessionId, {
          name: flowName.trim(),
          triggers,
          steps,
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

  const handleDeleteFlow = async (id: string) => {
    if (!confirm('Are you sure you want to delete this lead flow?')) return;
    try {
      await leadFlowsApi.deleteFlow(selectedSessionId, id);
      toast.info('Flow deleted');
      loadFlows();
    } catch (err) {
      toast.error('Failed to delete flow', err instanceof Error ? err.message : String(err));
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
            onClick={() => setActiveTab('flows')}
          >
            <GitBranch size={16} />
            Question Flows
          </button>
          <button
            className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`}
            onClick={() => setActiveTab('leads')}
          >
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
              <p>Create your first step-by-step flow to collect names, phone numbers, and requirements automatically.</p>
              <button className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={16} /> Create Flow
              </button>
            </div>
          ) : (
            <div className="flows-grid">
              {flows.map(flow => (
                <div key={flow.id} className="flow-card">
                  <div className="flow-card-header">
                    <h4>{flow.name}</h4>
                    <button
                      className="btn-icon-danger"
                      title="Delete flow"
                      onClick={() => handleDeleteFlow(flow.id)}
                    >
                      <Trash2 size={16} />
                    </button>
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
                      {(flow.steps || []).map((step, idx) => (
                        <li key={idx}>
                          <strong>[{step.key}]:</strong> {step.question}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="flow-completion">
                    <span className="label">On Complete:</span>
                    <p>{flow.completionMessage}</p>
                  </div>
                </div>
              ))}
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
              <p>When customers trigger your question flows on WhatsApp, their answers will appear here in real-time.</p>
            </div>
          ) : (
            <div className="leads-table-wrapper">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>Customer (WhatsApp)</th>
                    <th>Status</th>
                    <th>Collected Information</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map(lead => (
                    <tr key={lead.id}>
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
                  ))}
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
                    {steps.length > 1 && (
                      <button
                        type="button"
                        className="btn-icon-danger"
                        onClick={() => handleRemoveStep(idx)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>
                Completion Message <span title="Use {{field}} to interpolate answers"><HelpCircle size={12} /></span>
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

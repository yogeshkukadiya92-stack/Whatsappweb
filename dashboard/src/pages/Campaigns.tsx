import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  StopCircle,
  Upload,
  FileText,
  Users,
  Loader2,
  RefreshCw,
  Eye,
  Info,
} from 'lucide-react';
import {
  bulkMessageApi,
  type BulkMessageItem,
  type BatchStatusResponse,
  type Session,
} from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import './Campaigns.css';

interface LocalCampaignRecord {
  id: string; // batchId
  name: string;
  sessionId: string;
  sessionName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  delayMs: number;
}

const STORAGE_KEY_CAMPAIGNS = 'openwa_campaigns_history';

export function Campaigns() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();

  const [campaigns, setCampaigns] = useState<LocalCampaignRecord[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CAMPAIGNS);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [selectedBatchForDetails, setSelectedBatchForDetails] = useState<LocalCampaignRecord | null>(null);
  const [batchDetails, setBatchDetails] = useState<BatchStatusResponse | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Wizard state
  const [campaignName, setCampaignName] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [phoneNumbersRaw, setPhoneNumbersRaw] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [delaySec, setDelaySec] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync sessions select default
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Persist campaigns
  const saveCampaigns = (records: LocalCampaignRecord[]) => {
    setCampaigns(records);
    try {
      localStorage.setItem(STORAGE_KEY_CAMPAIGNS, JSON.stringify(records));
    } catch {
      // ignore
    }
  };

  // Poll running campaigns periodically
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === 'processing' || c.status === 'pending');
    if (!hasRunning) return;

    const interval = setInterval(async () => {
      let changed = false;
      const updated = await Promise.all(
        campaigns.map(async camp => {
          if (camp.status === 'processing' || camp.status === 'pending') {
            try {
              const res = await bulkMessageApi.getBatchStatus(camp.sessionId, camp.id);
              if (
                res.status !== camp.status ||
                res.progress.sent !== camp.sent ||
                res.progress.failed !== camp.failed
              ) {
                changed = true;
                return {
                  ...camp,
                  status: res.status,
                  sent: res.progress.sent,
                  failed: res.progress.failed,
                  total: res.progress.total,
                };
              }
            } catch {
              // Batch may have completed or session offline
            }
          }
          return camp;
        }),
      );

      if (changed) {
        saveCampaigns(updated);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [campaigns]);

  // Handle CSV upload
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      const text = String(evt.target?.result || '');
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // Extract numbers (if CSV has header, extract first numeric column or phone column)
      const parsedNumbers: string[] = [];
      lines.forEach((line, idx) => {
        const cols = line.split(',').map(c => c.replace(/["']/g, '').trim());
        if (idx === 0 && (cols[0].toLowerCase().includes('phone') || cols[0].toLowerCase().includes('number'))) {
          return; // Skip header
        }
        const candidate = cols[0];
        if (candidate) parsedNumbers.push(candidate);
      });

      if (parsedNumbers.length > 0) {
        setPhoneNumbersRaw(prev => (prev ? `${prev}\n${parsedNumbers.join('\n')}` : parsedNumbers.join('\n')));
        toast.info('Contacts Imported', `Imported ${parsedNumbers.length} phone numbers from CSV.`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Launch campaign
  const handleLaunchCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId || !messageBody.trim()) return;

    const rawList = phoneNumbersRaw
      .split(/[\n,]/)
      .map(n => n.trim())
      .filter(Boolean);

    if (rawList.length === 0) {
      toast.error('No Recipients', 'Please provide at least one phone number.');
      return;
    }

    // Format to WhatsApp JIDs (clean non-digit, prepend @c.us)
    const items: BulkMessageItem[] = rawList.map(item => {
      let digits = item.replace(/\D/g, '');
      if (digits.startsWith('0')) digits = digits.substring(1);
      const chatId = digits.includes('@') ? digits : `${digits}@c.us`;
      return {
        chatId,
        type: 'text',
        content: {
          text: messageBody.trim(),
        },
      };
    });

    setIsSubmitting(true);
    try {
      const res = await bulkMessageApi.sendBulk(selectedSessionId, {
        messages: items,
        options: {
          delayBetweenMessages: Math.max(1000, delaySec * 1000),
          stopOnError: false,
        },
      });

      const sessionObj = sessions.find(s => s.id === selectedSessionId);
      const newRecord: LocalCampaignRecord = {
        id: res.batchId,
        name: campaignName.trim() || `Campaign #${campaigns.length + 1}`,
        sessionId: selectedSessionId,
        sessionName: sessionObj?.name || selectedSessionId,
        status: res.status,
        total: items.length,
        sent: 0,
        failed: 0,
        createdAt: new Date().toISOString(),
        delayMs: delaySec * 1000,
      };

      saveCampaigns([newRecord, ...campaigns]);
      toast.success('Campaign Started', `Processing batch of ${items.length} messages.`);
      setIsWizardOpen(false);
      setCampaignName('');
      setPhoneNumbersRaw('');
      setMessageBody('');
    } catch (err) {
      toast.error('Failed to Start Campaign', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel campaign
  const handleCancel = async (camp: LocalCampaignRecord) => {
    try {
      await bulkMessageApi.cancelBatch(camp.sessionId, camp.id);
      const updated = campaigns.map(c => (c.id === camp.id ? { ...c, status: 'cancelled' as const } : c));
      saveCampaigns(updated);
      toast.info('Campaign Cancelled', `Campaign ${camp.name} was stopped.`);
    } catch (err) {
      toast.error('Cancellation Failed', err instanceof Error ? err.message : String(err));
    }
  };

  // Inspect campaign details
  const handleInspect = async (camp: LocalCampaignRecord) => {
    setSelectedBatchForDetails(camp);
    setLoadingDetails(true);
    try {
      const data = await bulkMessageApi.getBatchStatus(camp.sessionId, camp.id);
      setBatchDetails(data);
    } catch (err) {
      toast.error('Failed to load batch status', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="campaigns-page">
      <PageHeader
        title="Broadcasts & Campaigns"
        subtitle="Schedule and send bulk WhatsApp campaigns with smart anti-ban delays"
        actions={
          <button
            type="button"
            className="btn-primary btn-new-campaign"
            onClick={() => setIsWizardOpen(true)}
          >
            <Plus size={16} /> New Broadcast Campaign
          </button>
        }
      />

      {sessionsLoading ? (
        <div className="campaigns-loading">
          <Loader2 className="animate-spin" size={32} />
          <p>{t('common.loading')}</p>
        </div>
      ) : (
        <div className="campaigns-content">
          {/* Quick Metrics */}
          <div className="campaign-metrics-row">
            <div className="metric-card">
              <div className="metric-title">Total Campaigns</div>
              <div className="metric-value">{campaigns.length}</div>
            </div>
            <div className="metric-card">
              <div className="metric-title">Messages Sent</div>
              <div className="metric-value text-green">
                {campaigns.reduce((acc, c) => acc + c.sent, 0)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-title">Active Batches</div>
              <div className="metric-value text-blue">
                {campaigns.filter(c => c.status === 'processing' || c.status === 'pending').length}
              </div>
            </div>
          </div>

          {/* Campaign List */}
          <div className="campaigns-list">
            {campaigns.map(camp => {
              const percent = camp.total > 0 ? Math.round(((camp.sent + camp.failed) / camp.total) * 100) : 0;
              const isRunning = camp.status === 'processing' || camp.status === 'pending';

              return (
                <div key={camp.id} className="campaign-card">
                  <div className="campaign-card-header">
                    <div className="campaign-title-group">
                      <span className="campaign-name">{camp.name}</span>
                      <span className="campaign-session-badge">{camp.sessionName}</span>
                      <span className={`campaign-status-badge status-${camp.status}`}>
                        {camp.status}
                      </span>
                    </div>

                    <div className="campaign-actions">
                      {isRunning && (
                        <button
                          type="button"
                          className="btn-cancel-batch"
                          onClick={() => handleCancel(camp)}
                          title="Stop campaign immediately"
                        >
                          <StopCircle size={14} /> Stop
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-details-batch"
                        onClick={() => handleInspect(camp)}
                        title="View recipient details"
                      >
                        <Eye size={14} /> View Details
                      </button>
                    </div>
                  </div>

                  <div className="campaign-progress-bar-bg">
                    <div
                      className={`campaign-progress-bar-fill ${isRunning ? 'active' : ''}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <div className="campaign-card-footer">
                    <div className="campaign-stats-counts">
                      <span><strong>{camp.sent}</strong> sent</span>
                      <span>•</span>
                      <span className="text-red"><strong>{camp.failed}</strong> failed</span>
                      <span>•</span>
                      <span><strong>{camp.total}</strong> total ({percent}%)</span>
                    </div>
                    <div className="campaign-timestamp">
                      <Clock size={12} />
                      <span>{new Date(camp.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {campaigns.length === 0 && (
              <div className="campaigns-empty-state">
                <Users size={48} className="empty-icon" />
                <h3>No Broadcast Campaigns Yet</h3>
                <p>Launch bulk messages with throttling and templates to reach your audience.</p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setIsWizardOpen(true)}
                >
                  <Plus size={16} /> Create Your First Campaign
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Campaign Creation Wizard Modal */}
      {isWizardOpen && (
        <Modal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          title="Create WhatsApp Broadcast Campaign"
        >
          <form onSubmit={handleLaunchCampaign} className="campaign-wizard-form">
            <div className="form-group">
              <label>Campaign Title</label>
              <input
                type="text"
                placeholder="e.g. Diwali Festive Offer / Service Maintenance Update"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="camp-session-select">WhatsApp Sender Session</label>
              <select
                id="camp-session-select"
                value={selectedSessionId}
                onChange={e => setSelectedSessionId(e.target.value)}
                required
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.phone || 'No phone'})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <div className="recipients-label-row">
                <label htmlFor="camp-recipients-input">Recipients (Phone Numbers)</label>
                <label className="btn-csv-upload" title="Import from CSV / Excel file">
                  <Upload size={14} /> Import CSV
                  <input
                    type="file"
                    accept=".csv,.txt"
                    aria-label="Upload CSV file"
                    onChange={handleCsvUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
              <textarea
                id="camp-recipients-input"
                rows={4}
                placeholder="Enter numbers separated by comma or new line (e.g. 919876543210, +14155552671)"
                value={phoneNumbersRaw}
                onChange={e => setPhoneNumbersRaw(e.target.value)}
                required
              />
              <span className="field-hint">
                Numbers are automatically normalized with WhatsApp country codes.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="camp-message-body">Message Content</label>
              <textarea
                id="camp-message-body"
                rows={5}
                placeholder="Write your broadcast message here..."
                value={messageBody}
                onChange={e => setMessageBody(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="camp-delay-input">Anti-Ban Delay Between Messages (Throttling)</label>
              <div className="delay-input-row">
                <input
                  id="camp-delay-input"
                  type="number"
                  min={1}
                  max={60}
                  value={delaySec}
                  onChange={e => setDelaySec(Number(e.target.value))}
                  aria-label="Delay in seconds between messages"
                />
                <span>seconds per message</span>
              </div>
              <span className="field-hint">
                Recommended: 3 to 10 seconds to safeguard your number from WhatsApp rate limits and spam filters.
              </span>
            </div>

            <div className="wizard-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsWizardOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary btn-launch"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" size={16} /> Starting...
                  </>
                ) : (
                  <>
                    <Send size={16} /> Launch Broadcast
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Batch Details Modal */}
      {selectedBatchForDetails && (
        <Modal
          isOpen={Boolean(selectedBatchForDetails)}
          onClose={() => {
            setSelectedBatchForDetails(null);
            setBatchDetails(null);
          }}
          title={`Campaign Details: ${selectedBatchForDetails.name}`}
        >
          <div className="batch-details-modal">
            {loadingDetails ? (
              <div className="details-loading">
                <Loader2 className="animate-spin" size={24} />
                <p>Loading real-time batch results...</p>
              </div>
            ) : batchDetails ? (
              <>
                <div className="batch-summary-cards">
                  <div className="summary-pill sent">
                    <CheckCircle2 size={16} />
                    <span>Sent: {batchDetails.progress.sent}</span>
                  </div>
                  <div className="summary-pill failed">
                    <XCircle size={16} />
                    <span>Failed: {batchDetails.progress.failed}</span>
                  </div>
                  <div className="summary-pill pending">
                    <Clock size={16} />
                    <span>Pending: {batchDetails.progress.pending}</span>
                  </div>
                </div>

                <div className="results-table-container">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Status</th>
                        <th>Message ID / Error</th>
                        <th>Sent At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(batchDetails.results || []).map((res, idx) => (
                        <tr key={idx}>
                          <td>{res.chatId.replace('@c.us', '')}</td>
                          <td>
                            <span className={`result-tag ${res.status}`}>
                              {res.status}
                            </span>
                          </td>
                          <td className="col-id-error">
                            {res.status === 'sent' ? res.messageId || 'Delivered' : res.error || 'Failed'}
                          </td>
                          <td>
                            {res.sentAt ? new Date(res.sentAt).toLocaleTimeString() : '-'}
                          </td>
                        </tr>
                      ))}
                      {(!batchDetails.results || batchDetails.results.length === 0) && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            No message results yet. Campaign is queued.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>No details found for this batch.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Campaigns;

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Download,
  Search,
  Shield,
  Phone,
  Copy,
  Check,
  Loader2,
  Info,
} from 'lucide-react';
import { groupApi, type GroupItem, type GroupDetails, type Session } from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import './GroupContacts.css';

export function GroupContacts() {
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [searchGroup, setSearchGroup] = useState('');

  // Selected Group for View Details Modal
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [searchParticipant, setSearchParticipant] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Set default session
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Load Groups
  const loadGroups = useCallback(async () => {
    if (!selectedSessionId) return;
    setLoadingGroups(true);
    try {
      const data = await groupApi.list(selectedSessionId);
      setGroups(data || []);
    } catch (err) {
      toast.error('Failed to load groups', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingGroups(false);
    }
  }, [selectedSessionId, toast]);

  useEffect(() => {
    if (selectedSessionId) {
      loadGroups();
    }
  }, [selectedSessionId, loadGroups]);

  // View Members Modal
  const handleViewGroup = async (group: GroupItem) => {
    setSelectedGroup(group);
    setGroupDetails(null);
    setLoadingDetails(true);
    setSearchParticipant('');

    try {
      const details = await groupApi.getInfo(selectedSessionId, group.id);
      setGroupDetails(details);
    } catch (err) {
      toast.error('Failed to load group participants', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleExportSingleGroup = (groupId: string) => {
    window.open(groupApi.exportCsvUrl(selectedSessionId, groupId), '_blank');
    toast.success('Downloading group participants CSV...');
  };

  const handleExportAllGroups = () => {
    window.open(groupApi.exportAllCsvUrl(selectedSessionId), '_blank');
    toast.success('Downloading all groups participants CSV...');
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.info(`Copied: ${text}`);
  };

  const filteredGroups = groups.filter(g =>
    (g.name || '').toLowerCase().includes(searchGroup.toLowerCase()) ||
    g.id.toLowerCase().includes(searchGroup.toLowerCase())
  );

  const filteredParticipants = (groupDetails?.participants || []).filter(p => {
    const term = searchParticipant.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(term);
    const numMatch = (p.number || '').includes(term) || p.id.includes(term);
    return nameMatch || numMatch;
  });

  return (
    <div className="group-contacts-page">
      <PageHeader
        title="WhatsApp Group Contacts Extractor"
        subtitle="View and download participant names and mobile numbers from all your WhatsApp groups"
      />

      {/* Session & Action Bar */}
      <div className="group-top-bar">
        <div className="session-select-wrapper">
          <label htmlFor="group-session-select">Session:</label>
          {sessionsLoading ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <select
              id="group-session-select"
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

        <div className="group-global-actions">
          <button
            className="btn-export-all"
            onClick={handleExportAllGroups}
            disabled={loadingGroups || groups.length === 0}
          >
            <Download size={16} />
            Export ALL Groups Contacts (CSV)
          </button>
        </div>
      </div>

      {/* Search and Stats */}
      <div className="group-filter-row">
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search groups by name or ID..."
            value={searchGroup}
            onChange={e => setSearchGroup(e.target.value)}
          />
        </div>
        <div className="group-count-badge">
          Total Groups: <strong>{groups.length}</strong>
        </div>
      </div>

      {/* Groups List */}
      {loadingGroups ? (
        <div className="loading-state">
          <Loader2 className="animate-spin" size={28} />
          <span>Fetching WhatsApp groups...</span>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="empty-state">
          <Users size={48} className="empty-icon" />
          <h4>No WhatsApp groups found</h4>
          <p>Make sure your WhatsApp session is connected and ready.</p>
        </div>
      ) : (
        <div className="groups-grid">
          {filteredGroups.map(g => (
            <div key={g.id} className="group-card">
              <div className="group-card-top">
                <div className="group-avatar">
                  <Users size={22} />
                </div>
                <div className="group-info">
                  <h4 title={g.name}>{g.name || 'Unnamed Group'}</h4>
                  <span className="group-id">{g.id}</span>
                </div>
              </div>

              <div className="group-meta-row">
                <span className="meta-pill">
                  <Users size={13} /> {g.participantsCount ?? 'Members'}
                </span>
                {g.isAdmin && (
                  <span className="meta-pill-admin">
                    <Shield size={12} /> Admin
                  </span>
                )}
              </div>

              <div className="group-card-actions">
                <button
                  className="btn-view-members"
                  onClick={() => handleViewGroup(g)}
                >
                  <Users size={14} /> View Members
                </button>
                <button
                  className="btn-export-single"
                  onClick={() => handleExportSingleGroup(g.id)}
                  title="Download CSV for this group"
                >
                  <Download size={14} /> Download CSV
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View Participants Modal */}
      {selectedGroup && (
        <Modal
          open={Boolean(selectedGroup)}
          onClose={() => setSelectedGroup(null)}
          title={`Participants: ${selectedGroup.name || 'Group'}`}
          footer={
            <div className="modal-footer-actions">
              <button
                className="btn-primary"
                onClick={() => handleExportSingleGroup(selectedGroup.id)}
              >
                <Download size={16} /> Download Group CSV
              </button>
            </div>
          }
        >
          <div className="participants-modal-content">
            <div className="modal-filter-bar">
              <div className="search-box">
                <Search size={14} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search participants by name or phone..."
                  value={searchParticipant}
                  onChange={e => setSearchParticipant(e.target.value)}
                />
              </div>
              <span className="total-members-badge">
                {filteredParticipants.length} Participants
              </span>
            </div>

            {loadingDetails ? (
              <div className="loading-state">
                <Loader2 className="animate-spin" size={24} />
                <span>Loading participants...</span>
              </div>
            ) : filteredParticipants.length === 0 ? (
              <div className="empty-state">
                <Info size={32} />
                <p>No participants match your search.</p>
              </div>
            ) : (
              <div className="participants-table-wrapper">
                <table className="participants-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Mobile Number</th>
                      <th>Role</th>
                      <th>Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParticipants.map((p, idx) => {
                      const phoneNumber = p.number || p.id.replace('@c.us', '');
                      const isCopied = copiedId === p.id;
                      return (
                        <tr key={p.id}>
                          <td className="col-idx">{idx + 1}</td>
                          <td className="col-name">
                            <strong>{p.name || 'WhatsApp User'}</strong>
                          </td>
                          <td className="col-phone">
                            <span className="phone-badge">
                              <Phone size={12} /> +{phoneNumber}
                            </span>
                          </td>
                          <td className="col-role">
                            {p.isSuperAdmin ? (
                              <span className="role-super-admin">Super Admin</span>
                            ) : p.isAdmin ? (
                              <span className="role-admin">Admin</span>
                            ) : (
                              <span className="role-member">Member</span>
                            )}
                          </td>
                          <td className="col-action">
                            <button
                              className="btn-copy"
                              title="Copy Phone Number"
                              onClick={() => handleCopy(phoneNumber, p.id)}
                            >
                              {isCopied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
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
        </Modal>
      )}
    </div>
  );
}

export default GroupContacts;

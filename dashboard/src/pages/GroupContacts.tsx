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
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react';
import { groupApi, type GroupItem, type GroupDetails, type Session } from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import { useToast } from '../hooks/useToast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { isSessionStarted } from '../utils/sessionActions';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import './GroupContacts.css';

export function GroupContacts() {
  useDocumentTitle('Group Contacts Extractor');
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const toast = useToast();

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [searchGroup, setSearchGroup] = useState('');

  // Export progress states
  const [exportingGroupId, setExportingGroupId] = useState<string | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);

  // Selected Group for View Details Modal
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [searchParticipant, setSearchParticipant] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Prefer a session with a live engine. Persisted status can be stale after a server restart.
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      const startedSession = sessions.find(isSessionStarted);
      setSelectedSessionId(startedSession ? startedSession.id : sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Load Groups
  const loadGroups = useCallback(async () => {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!selectedSessionId || !session || !isSessionStarted(session)) {
      setGroups([]);
      setGroupsError(null);
      setLoadingGroups(false);
      return;
    }
    setLoadingGroups(true);
    setGroupsError(null);
    try {
      const data = await groupApi.list(selectedSessionId);
      setGroups(data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGroupsError(message);
      // Automatic loads should render the error inline. Toast only explicit refresh failures.
    } finally {
      setLoadingGroups(false);
    }
  }, [selectedSessionId, sessions]);

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
    setCopiedAll(false);

    try {
      const details = await groupApi.getInfo(selectedSessionId, group.id);
      setGroupDetails(details);
    } catch (err) {
      toast.error('Failed to load group participants', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetails(false);
    }
  };

  // Export single group members to Excel/CSV
  const handleExportSingleGroup = async (groupId: string, groupName?: string) => {
    try {
      setExportingGroupId(groupId);
      await groupApi.downloadGroupCsv(selectedSessionId, groupId, groupName);
      toast.success('Downloaded group members to Excel/CSV!', `${groupName || 'Group'} contact list saved.`);
    } catch (err) {
      toast.error('Failed to export group participants', err instanceof Error ? err.message : String(err));
    } finally {
      setExportingGroupId(null);
    }
  };

  // Export all groups to Excel/CSV
  const handleExportAllGroups = async () => {
    if (!selectedSessionId) return;
    try {
      setIsExportingAll(true);
      await groupApi.downloadAllGroupsCsv(selectedSessionId);
      toast.success('Downloaded all groups contacts to Excel/CSV!', 'All group participants exported successfully.');
    } catch (err) {
      toast.error('Failed to export all groups', err instanceof Error ? err.message : String(err));
    } finally {
      setIsExportingAll(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.info(`Copied: +${text}`);
  };

  const handleCopyAllNumbers = () => {
    if (!groupDetails?.participants?.length) return;
    const numbers = groupDetails.participants
      .map(p => p.number || p.id.replace('@c.us', ''))
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(numbers);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
    toast.success('Copied all numbers!', `${groupDetails.participants.length} phone numbers copied to clipboard.`);
  };

  const filteredGroups = groups.filter(
    g =>
      (g.name || '').toLowerCase().includes(searchGroup.toLowerCase()) ||
      g.id.toLowerCase().includes(searchGroup.toLowerCase()),
  );

  const filteredParticipants = (groupDetails?.participants || []).filter(p => {
    const term = searchParticipant.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(term);
    const numMatch = (p.number || '').includes(term) || p.id.includes(term);
    return nameMatch || numMatch;
  });
  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const selectedSessionStarted = selectedSession ? isSessionStarted(selectedSession) : false;

  return (
    <div className="group-contacts-page">
      <PageHeader
        title="WhatsApp Group Contacts Extractor"
        subtitle="Extract and download all group members' phone numbers and names into Excel/CSV"
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
                  {s.name} ({isSessionStarted(s) ? s.status : `${s.status}, not started`})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-refresh"
            onClick={() => void loadGroups()}
            disabled={loadingGroups || !selectedSessionId}
            title="Refresh Groups"
          >
            <RefreshCw size={15} className={loadingGroups ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="group-global-actions">
          <button
            type="button"
            className="btn-export-all"
            onClick={handleExportAllGroups}
            disabled={isExportingAll || loadingGroups || groups.length === 0}
            title="Download an Excel/CSV file with all participants from every WhatsApp group"
          >
            {isExportingAll ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {isExportingAll ? 'Exporting All Groups...' : 'Export ALL Groups to Excel (CSV)'}
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
          <Loader2 className="animate-spin" size={32} />
          <span>Fetching WhatsApp groups and member lists...</span>
        </div>
      ) : groupsError ? (
        <div className="empty-state">
          <Info size={42} className="empty-icon" />
          <h4>Couldn’t load WhatsApp groups</h4>
          <p>{groupsError}</p>
        </div>
      ) : !selectedSessionStarted ? (
        <div className="empty-state">
          <Info size={42} className="empty-icon" />
          <h4>WhatsApp session isn’t connected</h4>
          <p>Start this session from the Sessions page, then refresh the groups here.</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="empty-state">
          <Users size={48} className="empty-icon" />
          <h4>No WhatsApp groups found</h4>
          <p>
            {groups.length === 0
              ? 'Make sure your WhatsApp session is connected and ready.'
              : `No groups match "${searchGroup}".`}
          </p>
        </div>
      ) : (
        <div className="groups-grid">
          {filteredGroups.map(g => {
            const isExportingThis = exportingGroupId === g.id;
            return (
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
                    <Users size={13} /> {g.participantsCount !== undefined ? `${g.participantsCount} Members` : 'Group'}
                  </span>
                  {g.isAdmin && (
                    <span className="meta-pill-admin">
                      <Shield size={12} /> Admin
                    </span>
                  )}
                </div>

                <div className="group-card-actions">
                  <button
                    type="button"
                    className="btn-view-members"
                    onClick={() => handleViewGroup(g)}
                  >
                    <Users size={14} /> View Members
                  </button>
                  <button
                    type="button"
                    className="btn-export-single"
                    onClick={() => handleExportSingleGroup(g.id, g.name)}
                    disabled={isExportingThis}
                    title="Download members of this group into an Excel/CSV file"
                  >
                    {isExportingThis ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    {isExportingThis ? 'Exporting...' : 'Download Excel'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View Participants Modal */}
      {selectedGroup && (
        <Modal
          open={Boolean(selectedGroup)}
          onClose={() => setSelectedGroup(null)}
          title={`Group Members: ${selectedGroup.name || 'WhatsApp Group'}`}
          footer={
            <div className="modal-footer-actions">
              <button
                type="button"
                className="btn-copy-all"
                onClick={handleCopyAllNumbers}
                disabled={!groupDetails?.participants?.length}
              >
                {copiedAll ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                {copiedAll ? 'Numbers Copied!' : 'Copy All Numbers'}
              </button>
              <button
                type="button"
                className="btn-primary-export"
                onClick={() => handleExportSingleGroup(selectedGroup.id, selectedGroup.name)}
                disabled={exportingGroupId === selectedGroup.id}
              >
                {exportingGroupId === selectedGroup.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <FileSpreadsheet size={16} />
                )}
                {exportingGroupId === selectedGroup.id ? 'Exporting...' : 'Download Excel / CSV'}
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
                  placeholder="Search members by name or phone..."
                  value={searchParticipant}
                  onChange={e => setSearchParticipant(e.target.value)}
                  autoFocus
                />
              </div>
              <span className="total-members-badge">
                {filteredParticipants.length} {filteredParticipants.length === 1 ? 'Member' : 'Members'}
              </span>
            </div>

            {loadingDetails ? (
              <div className="loading-state">
                <Loader2 className="animate-spin" size={26} />
                <span>Loading group participants...</span>
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
                      <th>Participant Name</th>
                      <th>Mobile Number</th>
                      <th>Role</th>
                      <th>Action</th>
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
                              type="button"
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

import { useState } from 'react';
import { UserCheck, UserX, Search, Shield, Check } from 'lucide-react';
import { agentInboxStore, type AgentMember } from '../../services/agentInbox';
import { Modal } from '../Modal';
import './AgentAssignModal.css';

interface AgentAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  chatName: string;
  currentAgentId: string | null;
  onAssigned: (agentId: string | null) => void;
}

export function AgentAssignModal({
  isOpen,
  onClose,
  chatId,
  chatName,
  currentAgentId,
  onAssigned,
}: AgentAssignModalProps) {
  const [search, setSearch] = useState('');
  const agents = agentInboxStore.getAgents();

  const filteredAgents = agents.filter(
    a => a.name.toLowerCase().includes(search.toLowerCase()) || a.role.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = (agentId: string | null) => {
    agentInboxStore.assignChat(chatId, agentId);
    onAssigned(agentId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Conversation">
      <div className="agent-assign-container">
        <p className="agent-assign-subtitle">
          Assign <strong>{chatName}</strong> to a team member to manage responses and ownership.
        </p>

        <div className="agent-search-box">
          <Search size={16} className="agent-search-icon" />
          <input
            type="text"
            placeholder="Search team member or department..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="agent-list">
          {/* Unassigned Option */}
          <div
            className={`agent-item ${!currentAgentId ? 'selected' : ''}`}
            onClick={() => handleSelect(null)}
          >
            <div className="agent-avatar unassigned">
              <UserX size={18} />
            </div>
            <div className="agent-info">
              <div className="agent-name">Unassigned</div>
              <div className="agent-role">Move back to shared inbox pool</div>
            </div>
            {!currentAgentId && <Check size={18} className="agent-check" />}
          </div>

          {filteredAgents.map(agent => {
            const isSelected = currentAgentId === agent.id;
            return (
              <div
                key={agent.id}
                className={`agent-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelect(agent.id)}
              >
                <div className="agent-avatar" style={{ backgroundColor: agent.avatarColor }}>
                  {agent.name.charAt(0).toUpperCase()}
                </div>
                <div className="agent-info">
                  <div className="agent-name">{agent.name}</div>
                  <div className="agent-role">
                    <Shield size={12} style={{ display: 'inline', marginRight: 4 }} />
                    {agent.role}
                  </div>
                </div>
                {isSelected && <Check size={18} className="agent-check" />}
              </div>
            );
          })}

          {filteredAgents.length === 0 && (
            <div className="agent-empty">No team members match your search.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

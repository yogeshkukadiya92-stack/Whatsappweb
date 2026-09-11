import { useState, useEffect } from 'react';
import { Lock, Trash2, Send, Clock, User } from 'lucide-react';
import { agentInboxStore, type InternalNote } from '../../services/agentInbox';
import './InternalNotesSection.css';

interface InternalNotesSectionProps {
  chatId: string;
}

export function InternalNotesSection({ chatId }: InternalNotesSectionProps) {
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setNotes(agentInboxStore.getNotesForChat(chatId));
  }, [chatId]);

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    const created = agentInboxStore.addNote(chatId, newNote.trim());
    setNotes(prev => [...prev, created]);
    setNewNote('');
    setIsExpanded(true);
  };

  const handleDelete = (noteId: string) => {
    agentInboxStore.deleteNote(noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
  };

  const formatNoteTime = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className={`internal-notes-panel ${isExpanded ? 'expanded' : ''}`}>
      <div className="notes-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="notes-header-left">
          <Lock size={14} className="notes-lock-icon" />
          <span className="notes-title">Team Internal Notes</span>
          <span className="notes-count-badge">{notes.length}</span>
        </div>
        <span className="notes-toggle-hint">
          {isExpanded ? 'Hide' : notes.length > 0 ? 'View notes' : '+ Add Note'}
        </span>
      </div>

      {isExpanded && (
        <div className="notes-body">
          <div className="notes-security-notice">
            <Lock size={12} />
            <span>Private: Notes are only visible to your team members and NEVER sent over WhatsApp.</span>
          </div>

          <div className="notes-list">
            {notes.map(note => (
              <div key={note.id} className="note-card">
                <div className="note-card-header">
                  <div className="note-author">
                    <User size={12} />
                    <span>{note.authorName}</span>
                  </div>
                  <div className="note-time">
                    <Clock size={11} />
                    <span>{formatNoteTime(note.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="note-delete-btn"
                    title="Delete note"
                    onClick={() => handleDelete(note.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="note-content">{note.content}</div>
              </div>
            ))}

            {notes.length === 0 && (
              <div className="notes-empty">No internal notes for this conversation yet.</div>
            )}
          </div>

          <form onSubmit={handleAddNote} className="notes-form">
            <textarea
              rows={2}
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Add an internal note about customer requirement, handover, etc..."
            />
            <button type="submit" disabled={!newNote.trim()} className="btn-add-note">
              <Send size={14} /> Add Note
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

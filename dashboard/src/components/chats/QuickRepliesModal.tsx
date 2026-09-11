import { useState } from 'react';
import { Search, Plus, Trash2, ArrowRight } from 'lucide-react';
import { agentInboxStore, type QuickReply } from '../../services/agentInbox';
import { Modal } from '../Modal';
import './QuickRepliesModal.css';

interface QuickRepliesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSnippet: (snippetText: string) => void;
}

export function QuickRepliesModal({ isOpen, onClose, onSelectSnippet }: QuickRepliesModalProps) {
  const [search, setSearch] = useState('');
  const [replies, setReplies] = useState<QuickReply[]>(() => agentInboxStore.getQuickReplies());
  const [isCreating, setIsCreating] = useState(false);
  const [newShortcut, setNewShortcut] = useState('/');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('General');

  const filteredReplies = replies.filter(
    r =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.shortcut.toLowerCase().includes(search.toLowerCase()) ||
      r.content.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const formattedShortcut = newShortcut.startsWith('/') ? newShortcut.trim() : `/${newShortcut.trim()}`;
    const created = agentInboxStore.saveQuickReply({
      shortcut: formattedShortcut,
      title: newTitle.trim(),
      content: newContent.trim(),
      category: newCategory.trim(),
    });

    setReplies(prev => [...prev, created]);
    setIsCreating(false);
    setNewTitle('');
    setNewContent('');
    setNewShortcut('/');
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    agentInboxStore.deleteQuickReply(id);
    setReplies(prev => prev.filter(r => r.id !== id));
  };

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={onClose} title="⚡ Canned Responses & Quick Replies">
      <div className="quick-replies-container">
        {!isCreating ? (
          <>
            <div className="quick-replies-header-actions">
              <div className="qr-search-box">
                <Search size={16} className="qr-search-icon" />
                <input
                  type="text"
                  placeholder="Search template or shortcut..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                type="button"
                className="btn-primary qr-new-btn"
                onClick={() => setIsCreating(true)}
              >
                <Plus size={16} /> New Reply
              </button>
            </div>

            <div className="qr-list">
              {filteredReplies.map(reply => (
                <div
                  key={reply.id}
                  className="qr-item"
                  onClick={() => {
                    onSelectSnippet(reply.content);
                    onClose();
                  }}
                >
                  <div className="qr-item-header">
                    <span className="qr-shortcut">{reply.shortcut}</span>
                    <span className="qr-title">{reply.title}</span>
                    {reply.category && <span className="qr-category">{reply.category}</span>}
                    <button
                      type="button"
                      className="qr-delete-btn"
                      title="Delete reply"
                      onClick={e => handleDelete(reply.id, e)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="qr-content">{reply.content}</p>
                  <div className="qr-insert-hint">
                    Click to insert <ArrowRight size={12} />
                  </div>
                </div>
              ))}

              {filteredReplies.length === 0 && (
                <div className="qr-empty">No quick replies found. Create one to save time!</div>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={handleCreate} className="qr-create-form">
            <h4>Create New Quick Reply</h4>
            <div className="form-group">
              <label>Shortcut</label>
              <input
                type="text"
                value={newShortcut}
                onChange={e => setNewShortcut(e.target.value)}
                placeholder="/shortcut"
                required
              />
            </div>
            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Order Tracking Link"
                required
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <input
                type="text"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                placeholder="e.g. Sales, Support, FAQs"
              />
            </div>
            <div className="form-group">
              <label>Message Content</label>
              <textarea
                rows={4}
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="Enter the template text that will be inserted..."
                required
              />
            </div>
            <div className="qr-form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsCreating(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Quick Reply
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

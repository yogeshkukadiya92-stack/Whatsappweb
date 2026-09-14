import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Edit2, FileText, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { type MessageTemplate, type TemplatePayload } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useCreateTemplateMutation,
  useDeleteTemplateMutation,
  useSessionsQuery,
  useTemplatesQuery,
  useUpdateTemplateMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { copyToClipboard } from '../utils/clipboard';
import './Templates.css';

type TemplateForm = {
  name: string;
  header: string;
  body: string;
  footer: string;
};

const emptyForm: TemplateForm = {
  name: '',
  header: '',
  body: '',
  footer: '',
};

function extractPlaceholders(template: TemplateForm | MessageTemplate) {
  const source = [template.header, template.body, template.footer].filter(Boolean).join('\n');
  return Array.from(new Set(Array.from(source.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g), match => match[1]))).sort();
}

function toPayload(form: TemplateForm): TemplatePayload {
  return {
    name: form.name.trim(),
    header: form.header.trim() || null,
    body: form.body.trim(),
    footer: form.footer.trim() || null,
  };
}

function renderPreview(template: TemplateForm, values: Record<string, string>) {
  return [template.header, template.body, template.footer]
    .filter(Boolean)
    .join('\n\n')
    .replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => values[key] || `{{${key}}}`);
}

export function Templates() {
  const { t } = useTranslation();
  useDocumentTitle(t('templates.title'));
  const { canWrite } = useRole();
  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const toast = useToast();
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState('');

  const { data: templates = [], isLoading: loadingTemplates } = useTemplatesQuery(
    selectedSessionId,
    !!selectedSessionId,
  );
  const createMutation = useCreateTemplateMutation();
  const updateMutation = useUpdateTemplateMutation();
  const deleteMutation = useDeleteTemplateMutation();

  const selectedSession = sessions.find(session => session.id === selectedSessionId);
  const placeholders = useMemo(() => extractPlaceholders(form), [form]);
  const preview = useMemo(() => renderPreview(form, previewValues), [form, previewValues]);

  const filteredTemplates = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter(template =>
      [template.name, template.header, template.body, template.footer]
        .filter(Boolean)
        .some(value => value!.toLowerCase().includes(query)),
    );
  }, [searchTerm, templates]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    setPreviewValues(current => {
      const next: Record<string, string> = {};
      for (const key of placeholders) {
        next[key] = current[key] || '';
      }
      return next;
    });
  }, [placeholders]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingTemplate(null);
    setPreviewValues({});
    setIsEditorModalOpen(true);
  };

  const openEdit = (template: MessageTemplate) => {
    setEditingTemplate(template);
    setForm({
      name: template.name,
      header: template.header || '',
      body: template.body,
      footer: template.footer || '',
    });
    setIsEditorModalOpen(true);
  };

  const closeEditorModal = () => {
    setIsEditorModalOpen(false);
    setEditingTemplate(null);
    setForm(emptyForm);
    setPreviewValues({});
  };

  const handleSave = async () => {
    if (!selectedSessionId || !form.name.trim() || !form.body.trim()) return;

    try {
      if (editingTemplate) {
        await updateMutation.mutateAsync({
          sessionId: selectedSessionId,
          id: editingTemplate.id,
          data: toPayload(form),
        });
        toast.success(t('templates.toasts.updated'));
      } else {
        await createMutation.mutateAsync({
          sessionId: selectedSessionId,
          data: toPayload(form),
        });
        toast.success(t('templates.toasts.created'));
      }
      closeEditorModal();
    } catch (err) {
      toast.error(
        t(editingTemplate ? 'templates.toasts.updateFailed' : 'templates.toasts.createFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      );
    }
  };

  const handleDelete = async () => {
    if (!selectedSessionId || !deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ sessionId: selectedSessionId, id: deleteTarget.id });
      toast.success(t('templates.toasts.deleted'));
      if (editingTemplate?.id === deleteTarget.id) closeEditorModal();
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        t('templates.toasts.deleteFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      );
    }
  };

  const copyName = async (name: string) => {
    if (await copyToClipboard(name)) {
      toast.success(t('templates.toasts.copied'));
    }
  };

  if (loadingSessions) {
    return (
      <div className="templates-page templates-loading">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="templates-page">
      <PageHeader
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        actions={
          <div className="templates-header-actions-bar">
            <select
              className="templates-session-select"
              aria-label={t('templates.sessionSelect')}
              value={selectedSessionId}
              onChange={event => {
                setSelectedSessionId(event.target.value);
                closeEditorModal();
              }}
            >
              {sessions.length === 0 && <option value="">{t('templates.noSessions')}</option>}
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
            {canWrite && (
              <button className="btn-primary" onClick={openCreate} disabled={!selectedSessionId}>
                <Plus size={18} />
                {t('templates.newTemplate')}
              </button>
            )}
          </div>
        }
      />

      {sessions.length === 0 ? (
        <div className="templates-empty-page">
          <FileText size={48} strokeWidth={1} />
          <h3>{t('templates.empty.noSessionsTitle')}</h3>
          <p>{t('templates.empty.noSessionsDesc')}</p>
        </div>
      ) : (
        <div className="templates-list-view">
          {/* Filter & Toolbar */}
          <div className="templates-toolbar">
            <div className="templates-search-input">
              <Search size={16} />
              <input
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder={t('common.search')}
              />
            </div>
            <div className="templates-count-badge">
              <span>{t('templates.count', { count: filteredTemplates.length })}</span>
            </div>
          </div>

          {loadingTemplates ? (
            <div className="templates-loading-container">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : templates.length === 0 ? (
            <div className="templates-empty-state">
              <div className="empty-icon-wrap">
                <FileText size={44} strokeWidth={1.5} />
              </div>
              <h3>{t('templates.empty.title')}</h3>
              <p>{t('templates.empty.description')}</p>
              {canWrite && (
                <button className="btn-primary" onClick={openCreate} style={{ marginTop: '1rem' }}>
                  <Plus size={16} />
                  {t('templates.createTemplate')}
                </button>
              )}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="templates-empty-state">
              <Search size={36} strokeWidth={1.5} />
              <h3>{t('templates.empty.title')}</h3>
              <p>{t('common.noResults') || 'No templates match your search criteria.'}</p>
            </div>
          ) : (
            <div className="templates-grid">
              {filteredTemplates.map(template => {
                const templatePlaceholders = extractPlaceholders(template);
                return (
                  <div key={template.id} className="template-card">
                    <div className="template-card-header">
                      <div className="template-card-title-group">
                        <span className="template-card-title">{template.name}</span>
                        {template.header && <span className="template-card-tag">{template.header}</span>}
                      </div>
                      <div className="template-card-actions">
                        <button
                          className="icon-btn"
                          title={t('templates.actions.copyName')}
                          onClick={() => void copyName(template.name)}
                          type="button"
                        >
                          <Copy size={15} />
                        </button>
                        {canWrite && (
                          <>
                            <button
                              className="icon-btn"
                              title={t('common.edit') || 'Edit'}
                              onClick={() => openEdit(template)}
                              type="button"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              className="icon-btn danger"
                              title={t('common.delete')}
                              onClick={() => setDeleteTarget(template)}
                              type="button"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="template-card-body">
                      <p>{template.body}</p>
                    </div>

                    {template.footer && (
                      <div className="template-card-footer-text">
                        <small>{template.footer}</small>
                      </div>
                    )}

                    <div className="template-card-meta">
                      {templatePlaceholders.length > 0 ? (
                        <div className="template-placeholders-list">
                          {templatePlaceholders.map(key => (
                            <span key={key} className="placeholder-pill">
                              {`{{${key}}}`}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="no-placeholders-hint">{t('templates.noPlaceholders')}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Editor Modal with Live Preview */}
      {isEditorModalOpen && (
        <Modal
          open
          onClose={closeEditorModal}
          title={editingTemplate ? t('templates.editTitle') : t('templates.createTitle')}
          className="template-modal"
          closeLabel={t('common.close')}
          footer={
            <>
              <button className="btn-secondary" onClick={closeEditorModal} disabled={isSaving} type="button">
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!canWrite || isSaving || !selectedSessionId || !form.name.trim() || !form.body.trim()}
                type="button"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                {canWrite
                  ? t(editingTemplate ? 'templates.saveChanges' : 'templates.createTemplate')
                  : t('templates.viewOnly')}
              </button>
            </>
          }
        >
          <div className="template-modal-layout">
            <div className="template-modal-form">
              <div className="form-group">
                <label htmlFor="modal-tpl-name">{t('common.name')}</label>
                <input
                  id="modal-tpl-name"
                  value={form.name}
                  onChange={event => setForm({ ...form, name: event.target.value })}
                  placeholder={t('templates.namePlaceholder')}
                  disabled={!canWrite}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="modal-tpl-header">{t('templates.header')}</label>
                <input
                  id="modal-tpl-header"
                  value={form.header}
                  onChange={event => setForm({ ...form, header: event.target.value })}
                  placeholder={t('templates.headerPlaceholder')}
                  disabled={!canWrite}
                />
              </div>

              <div className="form-group">
                <label htmlFor="modal-tpl-body">{t('templates.body')}</label>
                <textarea
                  id="modal-tpl-body"
                  value={form.body}
                  onChange={event => setForm({ ...form, body: event.target.value })}
                  placeholder={t('templates.bodyPlaceholder')}
                  rows={6}
                  disabled={!canWrite}
                />
              </div>

              <div className="form-group">
                <label htmlFor="modal-tpl-footer">{t('templates.footer')}</label>
                <input
                  id="modal-tpl-footer"
                  value={form.footer}
                  onChange={event => setForm({ ...form, footer: event.target.value })}
                  placeholder={t('templates.footerPlaceholder')}
                  disabled={!canWrite}
                />
              </div>
            </div>

            <div className="template-modal-preview">
              <div className="preview-bubble-header">
                <span>{t('templates.previewTitle')}</span>
                {selectedSession && <small>{selectedSession.name}</small>}
              </div>

              <div className="whatsapp-preview-card">
                <div className="whatsapp-chat-bubble">
                  {form.header && <div className="whatsapp-bubble-header">{form.header}</div>}
                  <div className="whatsapp-bubble-body">
                    {preview || <span className="text-muted">{t('templates.previewEmpty')}</span>}
                  </div>
                  {form.footer && <div className="whatsapp-bubble-footer">{form.footer}</div>}
                  <div className="whatsapp-bubble-time">
                    12:00 PM <span className="double-check">✓✓</span>
                  </div>
                </div>
              </div>

              {placeholders.length > 0 && (
                <div className="template-test-variables">
                  <span className="test-variables-title">Test Variables Substitution:</span>
                  <div className="placeholder-inputs-grid">
                    {placeholders.map(key => (
                      <div key={key} className="placeholder-input-row">
                        <span>{`{{${key}}}`}</span>
                        <input
                          value={previewValues[key] || ''}
                          onChange={event => setPreviewValues({ ...previewValues, [key]: event.target.value })}
                          placeholder={t('templates.previewValuePlaceholder')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title={t('templates.deleteTitle')}
          className="modal-sm"
          closeLabel={t('common.close')}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                {t('common.delete')}
              </button>
            </>
          }
        >
          <p>{t('templates.deleteConfirm', { name: deleteTarget.name })}</p>
        </Modal>
      )}
    </div>
  );
}

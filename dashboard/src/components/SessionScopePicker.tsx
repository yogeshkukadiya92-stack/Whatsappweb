import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '../services/api';
import { sessionPickerStartsExpanded, sessionScopeRows } from '../utils/sessionScope';

interface SessionScopePickerProps {
  sessions: Session[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  required?: boolean;
  role?: string;
  forceExpanded?: boolean;
}

export function SessionScopePicker({
  sessions,
  selectedIds,
  onChange,
  disabled,
  required,
  role,
  forceExpanded,
}: SessionScopePickerProps) {
  const { t } = useTranslation();
  const isScopedRole = role === 'operator' || role === 'viewer' || required;
  const [expanded, setExpanded] = useState(
    () => forceExpanded || isScopedRole || sessionPickerStartsExpanded(selectedIds, role),
  );

  // Live sessions plus any selected id that no longer resolves to one
  const rows = sessionScopeRows(sessions, selectedIds);

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(current => current !== id) : [...selectedIds, id]);
  };

  const selectAll = () => {
    onChange(rows.map(r => r.id));
  };

  const clearAll = () => {
    onChange([]);
  };

  const chooseSessions = () => setExpanded(true);
  const leaveForAll = () => {
    onChange([]);
    setExpanded(false);
  };

  return (
    <div className="session-scope-picker" role="group" aria-label={t('apiKeys.sessions.label')}>
      {expanded ? (
        <>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}
          >
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {t('apiKeys.sessions.label', { defaultValue: 'Assigned WhatsApp Accounts' })}
              {selectedIds.length > 0 && (
                <span
                  style={{ marginLeft: '0.5rem', fontWeight: 500, fontSize: '0.75rem', color: 'var(--primary-text)' }}
                >
                  ({selectedIds.length} selected)
                </span>
              )}
            </span>
            {!isScopedRole ? (
              <button
                type="button"
                className="session-scope-toggle"
                onClick={leaveForAll}
                disabled={disabled}
                aria-expanded="true"
              >
                {t('apiKeys.sessions.leaveAll')}
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={disabled || rows.length === 0}
                  className="session-scope-action-btn"
                  style={{
                    fontSize: '0.75rem',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--primary-text)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Select All
                </button>
                <span style={{ color: 'var(--border)' }}>|</span>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={disabled || selectedIds.length === 0}
                  className="session-scope-action-btn"
                  style={{
                    fontSize: '0.75rem',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <p className="session-scope-hint" style={{ margin: '0 0 0.625rem' }}>
            {isScopedRole
              ? 'Select the specific WhatsApp account(s) this user can see and manage. They will NOT see any other accounts.'
              : t('apiKeys.sessions.hint')}
          </p>

          {rows.length > 0 && selectedIds.length === 0 && (
            <p
              className={isScopedRole ? 'session-scope-empty-warning' : 'session-scope-widened'}
              role="status"
              style={
                isScopedRole
                  ? {
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      color: 'var(--error-text)',
                      fontSize: '0.8125rem',
                      margin: '0 0 0.625rem',
                    }
                  : undefined
              }
            >
              {isScopedRole
                ? '⚠️ No accounts selected. This user will not see any chats or sessions upon logging in.'
                : t('apiKeys.sessions.all')}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="session-scope-empty">
              {t('apiKeys.sessions.empty', {
                defaultValue: 'No WhatsApp sessions found. Please create a session first in the Sessions tab.',
              })}
            </p>
          ) : (
            <ul className="session-scope-list">
              {rows.map(({ id, session }) => {
                const isSelected = selectedIds.includes(id);
                return (
                  <li key={id}>
                    <label
                      className="session-scope-option"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        cursor: 'pointer',
                        padding: '0.625rem 0.875rem',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(id)}
                        disabled={disabled}
                        style={{ cursor: 'pointer' }}
                      />
                      <span className="session-scope-meta" style={{ flex: 1 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="session-scope-name" style={{ fontWeight: 600 }}>
                            {session ? session.name : id}
                          </span>
                          {session?.status && (
                            <span
                              style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                background: session.status === 'ready' ? '#25d366' : 'var(--text-muted)',
                                display: 'inline-block',
                              }}
                              title={`Status: ${session.status}`}
                            />
                          )}
                        </span>
                        {session?.phone ? (
                          <span
                            className="session-scope-phone"
                            style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
                          >
                            {session.phone}
                          </span>
                        ) : (
                          !session && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--error-text)' }}>
                              (Deleted / Missing session)
                            </span>
                          )
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <button
          type="button"
          className="session-scope-toggle"
          onClick={chooseSessions}
          disabled={disabled}
          aria-expanded="false"
        >
          {t('apiKeys.sessions.choose')}
        </button>
      )}
    </div>
  );
}

import { scheduledMessageApi } from './api';

export const STORAGE_KEY_SCHEDULED = 'openwa_scheduled_messages';

export type ScheduledMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'forward'
  | 'bulk';

export interface ScheduledItem {
  id: string;
  sessionId: string;
  sessionName?: string;
  recipient: string;
  recipientType: 'personal' | 'group';
  messageType: ScheduledMessageType;
  scheduledAt: string; // ISO string
  createdAt: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  previewText: string;
  details: {
    content?: string;
    mediaUrl?: string;
    mediaFile?: { base64: string; mimetype: string; filename: string } | null;
    pollQuestion?: string;
    pollOptions?: string[];
    allowMultipleAnswers?: boolean;
    latitude?: string;
    longitude?: string;
    locationDescription?: string;
    locationAddress?: string;
    contactName?: string;
    contactNumber?: string;
    forwardFrom?: string;
    forwardTo?: string;
    forwardMessageId?: string;
    bulkRecipients?: string;
    bulkDelay?: string;
  };
  error?: string;
  recurrence?: { frequency: 'none' | 'daily' | 'weekly'; time: string; days?: number[]; endDate?: string };
}

export function parseBulkRecipients(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim().replace(/[^0-9]/g, ''))
    .filter(s => s.length >= 7)
    .map(s => (s.endsWith('@c.us') ? s : `${s}@c.us`));
}

export function getStoredScheduledItems(): ScheduledItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCHEDULED);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredScheduledItems(items: ScheduledItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_SCHEDULED, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('openwa_scheduled_updated'));
  } catch (err) {
    console.error('Failed to save scheduled items to localStorage:', err);
  }
}

export function normalizeTargetChatId(recipient: string, recipientType: 'personal' | 'group'): string {
  const trimmed = recipient.trim();
  if (recipientType === 'group') {
    if (trimmed.endsWith('@g.us')) return trimmed;
    // If user provided a raw phone/group id, append @g.us
    return `${trimmed.replace(/@.*$/, '')}@g.us`;
  }
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return `${digits}@c.us`;
}

export async function syncScheduledItemsWithBackend(sessionId?: string): Promise<ScheduledItem[]> {
  try {
    // Preserve the original browser queue before any server refresh. Import pending legacy
    // rows with a stable key so a lost response or a second tab cannot create duplicate jobs.
    const legacy = getStoredScheduledItems().filter(item => item.id.startsWith('sched_'));
    if (legacy.length && !localStorage.getItem(`${STORAGE_KEY_SCHEDULED}_legacy_backup`)) {
      localStorage.setItem(`${STORAGE_KEY_SCHEDULED}_legacy_backup`, JSON.stringify(legacy));
    }
    const unimported: ScheduledItem[] = [];
    for (const item of legacy) {
      if (item.status !== 'pending') { unimported.push(item); continue; }
      try {
        await scheduledMessageApi.create(item.sessionId, {
          clientId: item.id,
          recipient: item.recipient,
          recipientType: item.recipientType,
          messageType: item.messageType,
          scheduledAt: item.scheduledAt,
          previewText: item.previewText,
          details: item.details,
          recurrence: item.recurrence,
        });
      } catch {
        unimported.push({ ...item, error: 'Not yet saved on server. Keep this page open until migration succeeds.' });
      }
    }
    const backendItems = sessionId
      ? await scheduledMessageApi.list(sessionId)
      : await scheduledMessageApi.listAll();

    const mapped: ScheduledItem[] = backendItems.map(item => ({
      id: item.id,
      sessionId: item.sessionId,
      recipient: item.recipient,
      recipientType: item.recipientType || 'personal',
      messageType: item.messageType as any,
      scheduledAt: item.scheduledAt,
      createdAt: item.createdAt,
      status: item.status,
      previewText: item.previewText || `${item.messageType} message`,
      details: item.details || {},
      error: item.error || undefined,
      recurrence: item.recurrence,
    }));

    // A session-scoped refresh must not erase schedules belonging to other sessions.
    const otherSessions = sessionId ? getStoredScheduledItems().filter(item => item.sessionId !== sessionId && !item.id.startsWith('sched_')) : [];
    const combined = [...mapped, ...unimported, ...otherSessions];
    saveStoredScheduledItems(combined);
    return combined;
  } catch {
    return getStoredScheduledItems();
  }
}

/** Explicit manual send only. Automatic delivery belongs exclusively to the server. */
export async function executeScheduledMessage(item: ScheduledItem): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await scheduledMessageApi.sendNow(item.sessionId, item.id);
    await syncScheduledItemsWithBackend();
    return result;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Refresh the queue display; never send from a browser timer. */
export function startGlobalMessageScheduler(): () => void {
  let syncing = false;
  const refresh = async () => {
    if (syncing) return;
    syncing = true;
    try { await syncScheduledItemsWithBackend(); }
    finally { syncing = false; }
  };
  void refresh();
  const interval = setInterval(() => void refresh(), 15_000);
  window.addEventListener('focus', refresh);
  return () => {
    clearInterval(interval);
    window.removeEventListener('focus', refresh);
  };
}

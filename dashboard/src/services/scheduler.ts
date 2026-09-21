import { messageApi, type SendMediaPayload } from './api';

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

// Track running dispatches to avoid race conditions
const executingIds = new Set<string>();
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Dispatches a single scheduled item to the WhatsApp backend.
 */
export async function executeScheduledMessage(item: ScheduledItem): Promise<{ success: boolean; error?: string }> {
  if (executingIds.has(item.id)) {
    return { success: false, error: 'Already executing' };
  }
  executingIds.add(item.id);

  try {
    const { sessionId, recipient, recipientType, messageType: mType, details } = item;
    const targetChatId = normalizeTargetChatId(recipient, recipientType);

    switch (mType) {
      case 'text':
        if (!details.content?.trim()) {
          throw new Error('Message text content is empty');
        }
        await messageApi.sendText(sessionId, targetChatId, details.content.trim());
        break;

      case 'poll': {
        const question = details.pollQuestion?.trim();
        const rawOptions = details.pollOptions || [];
        const validOptions = rawOptions.map(o => o.trim()).filter(o => o.length > 0);

        if (!question) {
          throw new Error('Poll question cannot be empty');
        }
        if (validOptions.length < 2) {
          throw new Error(`Poll requires at least 2 options (found ${validOptions.length})`);
        }
        if (validOptions.length > 12) {
          throw new Error(`Poll cannot exceed 12 options (found ${validOptions.length})`);
        }

        await messageApi.sendPoll(sessionId, {
          chatId: targetChatId,
          name: question,
          options: validOptions,
          allowMultipleAnswers: !!details.allowMultipleAnswers,
        });
        break;
      }

      case 'image':
      case 'video':
      case 'audio':
      case 'document': {
        const payload: SendMediaPayload = details.mediaFile
          ? { base64: details.mediaFile.base64, mimetype: details.mediaFile.mimetype, filename: details.mediaFile.filename }
          : { url: details.mediaUrl || '' };

        if (!payload.base64 && !payload.url) {
          throw new Error('No media file or URL provided');
        }
        if ((mType === 'image' || mType === 'video') && details.content) {
          payload.caption = details.content.trim();
        }
        if (mType === 'document' && details.content) {
          payload.filename = details.content.trim();
        }

        await messageApi.sendMedia(sessionId, targetChatId, mType, payload);
        break;
      }

      case 'sticker': {
        const payload: SendMediaPayload = details.mediaFile
          ? { base64: details.mediaFile.base64, mimetype: details.mediaFile.mimetype }
          : { url: details.mediaUrl || '' };

        if (!payload.base64 && !payload.url) {
          throw new Error('No sticker file or URL provided');
        }
        await messageApi.sendSticker(sessionId, targetChatId, payload);
        break;
      }

      case 'location': {
        const lat = parseFloat(details.latitude || '');
        const lng = parseFloat(details.longitude || '');
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
          throw new Error('Invalid latitude or longitude');
        }
        await messageApi.sendLocation(sessionId, {
          chatId: targetChatId,
          latitude: lat,
          longitude: lng,
          ...(details.locationDescription?.trim() ? { description: details.locationDescription.trim() } : {}),
          ...(details.locationAddress?.trim() ? { address: details.locationAddress.trim() } : {}),
        });
        break;
      }

      case 'contact': {
        const name = details.contactName?.trim();
        const number = details.contactNumber?.trim();
        if (!name || !number) {
          throw new Error('Contact name and number are required');
        }
        await messageApi.sendContact(sessionId, {
          chatId: targetChatId,
          contactName: name,
          contactNumber: number,
        });
        break;
      }

      case 'forward': {
        if (!details.forwardMessageId?.trim()) {
          throw new Error('Forward message ID is required');
        }
        let toChatId = (details.forwardTo || targetChatId).trim();
        if (!toChatId.includes('@')) {
          toChatId = `${toChatId.replace(/[^0-9]/g, '')}@c.us`;
        }
        await messageApi.forward(sessionId, {
          fromChatId: details.forwardFrom?.trim() || targetChatId,
          toChatId,
          messageId: details.forwardMessageId.trim(),
        });
        break;
      }

      case 'bulk': {
        const recipients = parseBulkRecipients(details.bulkRecipients || '');
        if (!recipients.length) {
          throw new Error('No valid recipients found for bulk message');
        }
        await messageApi.sendBulk(sessionId, {
          confirmedOptIn: true,
          messages: recipients.map(chatId => ({
            chatId,
            type: 'text' as const,
            content: { text: details.content || '' },
          })),
          ...(details.bulkDelay ? { options: { delayBetweenMessages: Number(details.bulkDelay) } } : {}),
        });
        break;
      }

      default:
        throw new Error(`Unsupported message type: ${mType}`);
    }

    // Success: mark as 'sent'
    const all = getStoredScheduledItems();
    const updated = all.map(i => (i.id === item.id ? { ...i, status: 'sent' as const, error: undefined } : i));

    // Handle recurrence
    const rule = item.recurrence;
    if (rule && rule.frequency !== 'none') {
      const next = new Date(item.scheduledAt);
      if (rule.frequency === 'daily') next.setDate(next.getDate() + 1);
      if (rule.frequency === 'weekly') {
        let guard = 0;
        do {
          next.setDate(next.getDate() + 1);
          guard += 1;
        } while (rule.days?.length && !rule.days.includes(next.getDay()) && guard < 8);
      }
      const nextTime = (rule.time || '09:00').split(':').map(Number);
      next.setHours(nextTime[0] || 0, nextTime[1] || 0, 0, 0);

      const withinEnd = !rule.endDate || next <= new Date(`${rule.endDate}T23:59:59`);
      if (withinEnd) {
        const nextItem: ScheduledItem = {
          ...item,
          id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          scheduledAt: next.toISOString(),
          createdAt: new Date().toISOString(),
          status: 'pending',
          error: undefined,
        };
        updated.unshift(nextItem);
        armTimer(nextItem);
      }
    }

    saveStoredScheduledItems(updated);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Scheduled message dispatch failed for item ${item.id}:`, err);

    const all = getStoredScheduledItems();
    const updated = all.map(i =>
      i.id === item.id ? { ...i, status: 'failed' as const, error: errorMsg } : i,
    );
    saveStoredScheduledItems(updated);
    return { success: false, error: errorMsg };
  } finally {
    executingIds.delete(item.id);
    activeTimers.delete(item.id);
  }
}

function armTimer(item: ScheduledItem) {
  if (item.status !== 'pending') return;
  if (activeTimers.has(item.id)) return;

  const delay = Math.max(0, new Date(item.scheduledAt).getTime() - Date.now());
  // If due within 24 hours, arm a memory timer
  if (delay < 24 * 60 * 60 * 1000) {
    const timer = setTimeout(() => {
      void executeScheduledMessage(item);
    }, delay);
    activeTimers.set(item.id, timer);
  }
}

/**
 * Initializes the background scheduler. Checks for pending due items and re-arms timers.
 * Should be mounted globally once in Layout.
 */
export function startGlobalMessageScheduler(): () => void {
  const syncAndArmAll = () => {
    const items = getStoredScheduledItems();
    const now = Date.now();

    for (const item of items) {
      if (item.status === 'pending') {
        const itemTime = new Date(item.scheduledAt).getTime();
        if (itemTime <= now) {
          // Already due! Execute right now
          void executeScheduledMessage(item);
        } else {
          armTimer(item);
        }
      }
    }
  };

  // Run initial check
  syncAndArmAll();

  // Heartbeat check every 10 seconds in case timers drifted or computer awoke from sleep
  const interval = setInterval(() => {
    syncAndArmAll();
  }, 10_000);

  // Re-check whenever tab gains focus
  const onFocus = () => {
    syncAndArmAll();
  };
  window.addEventListener('focus', onFocus);
  window.addEventListener('openwa_scheduled_updated', onFocus);

  return () => {
    clearInterval(interval);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('openwa_scheduled_updated', onFocus);
    for (const timer of activeTimers.values()) {
      clearTimeout(timer);
    }
    activeTimers.clear();
  };
}

import { useState, useEffect, useRef, useMemo, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send,
  CheckCircle,
  XCircle,
  Loader2,
  Upload,
  X,
  Plus,
  Clock,
  FileText,
  Globe,
  Trash2,
  Calendar,
  BarChart2,
  MapPin,
  User,
  Share2,
  Layers,
  Image as ImageIcon,
  Search,
  Users,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Pencil,
  Copy,
  Play,
} from 'lucide-react';
import {
  messageApi,
  contactApi,
  scheduledMessageApi,
  type SendMediaPayload,
  type MessageResponse,
  type BatchStatus,
  type BatchStatusResponse,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import { useSessionsQuery, useSessionGroupsQuery, useSessionChatsQuery } from '../hooks/queries';
import { parseBulkRecipients, BULK_MAX_RECIPIENTS, BULK_RECIPIENTS_FILE_MAX_BYTES } from '../utils/bulkRecipients';
import {
  type ScheduledItem,
  STORAGE_KEY_SCHEDULED,
  getStoredScheduledItems,
  saveStoredScheduledItems,
  syncScheduledItemsWithBackend,
} from '../services/scheduler';
import { PageHeader } from '../components/PageHeader';
import './MessageTester.css';

interface ApiResponse {
  success: boolean;
  messageId?: string;
  /** Bulk sends return 202 + a batch instead of a messageId; the panel polls its progress. */
  batchId?: string;
  timestamp: string;
  error?: string;
  status?: number;
}

const calendarWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDateTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${toLocalDateKey(date)}T${hours}:${minutes}`;
}

const messageTypes = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'location',
  'contact',
  'sticker',
  'poll',
  'forward',
  'bulk',
] as const;

// The types that share the media upload/URL block (base64 XOR url + mimetype).
const mediaMessageTypes: readonly string[] = ['image', 'video', 'audio', 'document', 'sticker'];

// Hint the native file picker at the right category (documents accept anything).
const mediaAccept: Record<(typeof messageTypes)[number], string> = {
  text: '*/*',
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  document: '*/*',
  location: '*/*',
  contact: '*/*',
  sticker: 'image/*',
  poll: '*/*',
  forward: '*/*',
  bulk: '*/*',
};

// Fallback MIME for when the browser leaves File.type empty (some extensions). The backend requires a
// mimetype on every base64 send, so default by the selected message category.
const fallbackMime: Record<(typeof messageTypes)[number], string> = {
  text: 'text/plain',
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  document: 'application/octet-stream',
  location: 'application/octet-stream',
  contact: 'application/octet-stream',
  sticker: 'image/webp',
  poll: 'application/octet-stream',
  forward: 'application/octet-stream',
  bulk: 'application/octet-stream',
};

// Client pre-check before base64-encoding an upload. Aligned with the default request-body limit: base64
// inflates ~1.33x, so ~18 MiB raw stays under the 25 MiB BODY_SIZE_LIMIT and lets the backend reject with a
// clear 413 instead of the tab OOMing on a multi-hundred-MB pick before the request is even sent. The
// backend's MEDIA_DOWNLOAD_MAX_BYTES (default 50 MiB) stays authoritative for URL sends (fetched server-side).
const MEDIA_UPLOAD_MAX_BYTES = 18 * 1024 * 1024;

function formatRelativeTime(timestamp?: number): string | null {
  if (!timestamp || timestamp <= 0) return null;
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const diff = Date.now() - ms;
  if (diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Batch statuses that stop the progress polling (mirrors the backend BatchStatus enum).
const TERMINAL_BATCH_STATUSES: readonly BatchStatus[] = ['completed', 'cancelled', 'failed'];

export function MessageTester() {
  const { t } = useTranslation();
  useDocumentTitle(t('messageTester.title'));
  const { canWrite } = useRole();
  const toast = useToast();
  const { data: allSessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const sessions = allSessions.filter(s => s.status === 'ready');
  const [session, setSession] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientType, setRecipientType] = useState<'personal' | 'group'>('personal');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [isCustomGroup, setIsCustomGroup] = useState(false);
  const [customGroupId, setCustomGroupId] = useState('');
  const preserveGroupRef = useRef<string | null>(null);
  const [queueTab, setQueueTab] = useState<'all' | 'calendar'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'sent' | 'failed'>('all');
  const [messageType, setMessageType] = useState<(typeof messageTypes)[number]>('text');
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  // Explicit tab selection: 'upload' (local file) vs 'url' (web link), so user never thinks a URL is mandatory
  const [mediaSourceTab, setMediaSourceTab] = useState<'upload' | 'url'>('upload');
  // Scheduling state
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly'>('none');
  const [recurrenceTime, setRecurrenceTime] = useState('09:00');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([1]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [editingScheduledId, setEditingScheduledId] = useState<string | null>(null);
  const composePanelRef = useRef<HTMLDivElement>(null);
  // A locally-picked media file, read as raw base64 (the engine contract — NOT a data: URI). Mutually
  // exclusive with mediaUrl: picking a file clears the URL field; typing a URL drops the file.
  const [mediaFile, setMediaFile] = useState<{ base64: string; mimetype: string; filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  // Monotonic token invalidating an in-flight FileReader: a second pick, a URL edit, a removal,
  // or an unmount before `onload` fires must win over the late-arriving bytes — otherwise the
  // slower read overwrites the newer state (and re-clears a URL the user just typed).
  const mediaReadSeq = useRef(0);
  const clearMediaFile = () => {
    mediaReadSeq.current += 1;
    setMediaFile(null);
  };
  useEffect(() => {
    return () => {
      mediaReadSeq.current += 1;
    };
  }, []);
  // Per-type fields for the non-media types; text/media keep using `content`/`mediaUrl` above.
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locationDescription, setLocationDescription] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const pollQuestionRef = useRef<HTMLTextAreaElement>(null);
  // WhatsApp caps polls at 2..12 options; rows are trimmed and empty ones dropped at send time.
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [allowMultipleAnswers, setAllowMultipleAnswers] = useState(false);
  const [forwardFrom, setForwardFrom] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [forwardMessageId, setForwardMessageId] = useState('');
  const [bulkRecipients, setBulkRecipients] = useState('');
  const [bulkDelay, setBulkDelay] = useState('');
  const [bulkConfirmedOptIn, setBulkConfirmedOptIn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  // Live bulk-batch progress, polled every ~2s while the batch runs (see startBatchPolling).
  const [batchStatus, setBatchStatus] = useState<BatchStatusResponse | null>(null);
  const [batchCancelling, setBatchCancelling] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The session a running batch belongs to: the user may switch the selector mid-batch, and
  // poll/cancel must keep addressing the session the batch was created on.
  const batchSessionRef = useRef('');

  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SCHEDULED);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const initialCalendarDate = useMemo(() => {
    const firstPending = [...scheduledItems]
      .filter(item => item.status === 'pending')
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
    return firstPending ? new Date(firstPending.scheduledAt) : new Date();
  }, []);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toLocalDateKey(initialCalendarDate));
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(initialCalendarDate.getFullYear(), initialCalendarDate.getMonth(), 1),
  );

  const scheduledItemsByDate = useMemo(() => {
    const byDate = new Map<string, ScheduledItem[]>();
    for (const item of scheduledItems) {
      const key = toLocalDateKey(new Date(item.scheduledAt));
      byDate.set(key, [...(byDate.get(key) || []), item]);
    }
    return byDate;
  }, [scheduledItems]);

  const selectedDayItems = useMemo(
    () =>
      [...(scheduledItemsByDate.get(selectedCalendarDate) || [])].sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      ),
    [scheduledItemsByDate, selectedCalendarDate],
  );

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDayOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: firstDayOffset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1)),
    ];
  }, [calendarMonth]);

  const selectCalendarDate = (date: Date) => {
    setSelectedCalendarDate(toLocalDateKey(date));
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  // Save to localStorage whenever scheduled items change
  const updateScheduledItems = (updater: (prev: ScheduledItem[]) => ScheduledItem[]) => {
    setScheduledItems(prev => {
      const next = updater(prev);
      saveStoredScheduledItems(next);
      return next;
    });
  };

  // Initial & session sync from backend database
  useEffect(() => {
    let isMounted = true;
    syncScheduledItemsWithBackend(session).then(items => {
      if (isMounted) {
        setScheduledItems(items);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [session]);

  // Synchronize scheduled items whenever the global scheduler updates
  useEffect(() => {
    const handleSync = () => {
      setScheduledItems(getStoredScheduledItems());
    };
    window.addEventListener('openwa_scheduled_updated', handleSync);
    window.addEventListener('focus', handleSync);
    return () => {
      window.removeEventListener('openwa_scheduled_updated', handleSync);
      window.removeEventListener('focus', handleSync);
    };
  }, []);

  const cancelScheduledItem = async (id: string) => {
    const item = scheduledItems.find(i => i.id === id);
    if (!item) return;
    try {
      await scheduledMessageApi.cancel(item.sessionId, id);
      await syncScheduledItemsWithBackend();
      if (editingScheduledId === id) setEditingScheduledId(null);
      toast.success('Scheduled message cancelled');
    } catch (err) {
      toast.error('Cancellation was not saved', err instanceof Error ? err.message : String(err));
    }
  };

  const displayedItems = useMemo(() => {
    const sourceList = queueTab === 'calendar' ? selectedDayItems : scheduledItems;
    let filtered = sourceList;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => item.status === statusFilter);
    }
    return [...filtered].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
    });
  }, [queueTab, selectedDayItems, scheduledItems, statusFilter]);

  const startNewScheduleForDate = (dateKey: string) => {
    const selectedDate = fromLocalDateKey(dateKey);
    const now = new Date();
    if (selectedDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return;

    if (dateKey === toLocalDateKey(now)) {
      now.setMinutes(Math.ceil((now.getMinutes() + 1) / 5) * 5, 0, 0);
      setScheduledDateTime(toLocalDateTimeInput(now));
    } else {
      selectedDate.setHours(9, 0, 0, 0);
      setScheduledDateTime(toLocalDateTimeInput(selectedDate));
    }
    setEditingScheduledId(null);
    setIsScheduled(true);
    setResponse(null);
    composePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const editScheduledItem = (item: ScheduledItem) => {
    setEditingScheduledId(item.id);
    preserveGroupRef.current = item.recipientType === 'group' ? item.recipient : null;
    setSession(item.sessionId);
    setRecipientType(item.recipientType);
    if (item.recipientType === 'group') {
      setSelectedGroup(item.recipient);
      setCustomGroupId(item.recipient);
    } else {
      setRecipient(item.recipient.replace(/@.*$/, ''));
    }
    setMessageType(item.messageType);
    setContent(item.details.content || '');
    setMediaUrl(item.details.mediaUrl || '');
    setMediaFile(item.details.mediaFile || null);
    setMediaSourceTab(item.details.mediaFile ? 'upload' : 'url');
    setPollQuestion(item.details.pollQuestion || '');
    setPollOptions(item.details.pollOptions?.length ? item.details.pollOptions : ['', '']);
    setAllowMultipleAnswers(!!item.details.allowMultipleAnswers);
    setLatitude(item.details.latitude || '');
    setLongitude(item.details.longitude || '');
    setLocationDescription(item.details.locationDescription || '');
    setLocationAddress(item.details.locationAddress || '');
    setContactName(item.details.contactName || '');
    setContactNumber(item.details.contactNumber || '');
    setForwardFrom(item.details.forwardFrom || '');
    setForwardTo(item.details.forwardTo || '');
    setForwardMessageId(item.details.forwardMessageId || '');
    setBulkRecipients(item.details.bulkRecipients || '');
    setBulkDelay(item.details.bulkDelay || '');
    setBulkConfirmedOptIn(item.messageType === 'bulk');
    setIsScheduled(true);
    setScheduledDateTime(toLocalDateTimeInput(new Date(item.scheduledAt)));
    setRecurrence(item.recurrence?.frequency || 'none');
    setRecurrenceTime(item.recurrence?.time || '09:00');
    setRecurrenceDays(item.recurrence?.days || [1]);
    setRecurrenceEndDate(item.recurrence?.endDate || '');
    setResponse(null);
    composePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const duplicateScheduledItem = async (item: ScheduledItem) => {
    // If original scheduled time is already past, push it to future (now + 10 mins rounded to 5 mins)
    let newScheduledAt = item.scheduledAt;
    const itemTime = new Date(item.scheduledAt).getTime();
    const now = Date.now();
    if (itemTime <= now) {
      const futureDate = new Date(now + 10 * 60 * 1000);
      futureDate.setMinutes(Math.ceil(futureDate.getMinutes() / 5) * 5, 0, 0);
      newScheduledAt = futureDate.toISOString();
    }

    let newItem: ScheduledItem = {
      ...item,
      id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      scheduledAt: newScheduledAt,
      createdAt: new Date().toISOString(),
      status: 'pending',
      error: undefined,
      details: {
        ...item.details,
        pollOptions: item.details.pollOptions ? [...item.details.pollOptions] : undefined,
      },
      recurrence: item.recurrence
        ? {
            ...item.recurrence,
            days: item.recurrence.days ? [...item.recurrence.days] : undefined,
          }
        : undefined,
    };

    // Try saving directly to backend database
    try {
      const created = await scheduledMessageApi.create(item.sessionId, {
        recipient: newItem.recipient,
        recipientType: newItem.recipientType,
        messageType: newItem.messageType,
        scheduledAt: newItem.scheduledAt,
        previewText: newItem.previewText,
        details: newItem.details,
        recurrence: newItem.recurrence,
      });
      newItem.id = created.id;
      newItem.createdAt = created.createdAt;
      newItem.status = created.status;
    } catch (err) {
      toast.error('Schedule was not saved', err instanceof Error ? err.message : String(err));
      return;
    }

    // Insert right after the duplicated item in the list
    updateScheduledItems(prev => {
      const idx = prev.findIndex(i => i.id === item.id);
      if (idx !== -1) {
        const next = [...prev];
        next.splice(idx + 1, 0, newItem);
        return next;
      }
      return [newItem, ...prev];
    });

    // Make sure calendar displays the date of the duplicated item
    selectCalendarDate(new Date(newItem.scheduledAt));

    // Load duplicated item into composer so user can immediately view or edit it
    editScheduledItem(newItem);

    toast.success('Message duplicated successfully!');
  };

  // Immediate send action for testing or manual execution from queue
  const handleSendNow = async (item: ScheduledItem) => {
    toast.info('Sending message now...', 'Please wait while message is delivered');
    let success = false;
    let error: string | undefined;

    try {
      const res = await scheduledMessageApi.sendNow(item.sessionId, item.id);
      success = !!res?.success;
      error = res.error;
    } catch (err: any) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (success) {
      toast.success('Message sent successfully!');
      await syncScheduledItemsWithBackend(session);
      setScheduledItems(getStoredScheduledItems());
    } else {
      toast.error('Failed to send', error || 'Send failed');
      await syncScheduledItemsWithBackend(session);
      setScheduledItems(getStoredScheduledItems());
    }
  };

  const { data: groups = [], isLoading: loadingGroups } = useSessionGroupsQuery(session, recipientType === 'group');
  const { data: chats = [] } = useSessionChatsQuery(session, recipientType === 'group');

  const [groupSearch, setGroupSearch] = useState('');
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(event.target as Node)) {
        setIsGroupDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Map chat timestamps and previews by ID for fast lookup
  const chatTimestampMap = useMemo(() => {
    const map = new Map<string, { timestamp: number; lastMessage?: string }>();
    for (const c of chats) {
      if (c.id) {
        map.set(c.id, { timestamp: c.timestamp || 0, lastMessage: c.lastMessage });
      }
    }
    return map;
  }, [chats]);

  // Sort groups with most recent activity first, falling back to alphabetical
  const sortedGroups = useMemo(() => {
    if (!groups.length) return [];
    return [...groups]
      .map(g => {
        const chatInfo = chatTimestampMap.get(g.id);
        const effectiveTimestamp = Math.max(g.timestamp || 0, chatInfo?.timestamp || 0);
        return {
          ...g,
          effectiveTimestamp,
          lastMessage: chatInfo?.lastMessage,
        };
      })
      .sort((a, b) => {
        if (b.effectiveTimestamp !== a.effectiveTimestamp) {
          return b.effectiveTimestamp - a.effectiveTimestamp;
        }
        return a.name.localeCompare(b.name);
      });
  }, [groups, chatTimestampMap]);

  // Filter sorted groups by search query
  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return sortedGroups;
    const q = groupSearch.toLowerCase().trim();
    return sortedGroups.filter(g => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q));
  }, [sortedGroups, groupSearch]);

  const selectedGroupObj = useMemo(() => {
    return sortedGroups.find(g => g.id === selectedGroup);
  }, [sortedGroups, selectedGroup]);

  useEffect(() => {
    if (sessions.length > 0 && !session) {
      setSession(sessions[0].id);
    }
  }, [sessions, session]);

  // Clear group selection & search query when session changes (unless preserved from editing)
  useEffect(() => {
    if (preserveGroupRef.current) {
      setSelectedGroup(preserveGroupRef.current);
      setCustomGroupId(preserveGroupRef.current);
      preserveGroupRef.current = null;
    } else {
      setSelectedGroup('');
    }
    setGroupSearch('');
  }, [session]);

  // Automatically select the most recent group by default
  useEffect(() => {
    if (recipientType === 'group' && sortedGroups.length > 0 && !selectedGroup && !isCustomGroup) {
      setSelectedGroup(sortedGroups[0].id);
    }
    if (recipientType !== 'group') {
      setSelectedGroup('');
      setGroupSearch('');
      setIsGroupDropdownOpen(false);
    }
  }, [sortedGroups, selectedGroup, recipientType, isCustomGroup]);

  const stopBatchPolling = () => {
    if (batchPollRef.current) {
      clearInterval(batchPollRef.current);
      batchPollRef.current = null;
    }
  };

  // Stop polling on unmount; the batch itself keeps running server-side regardless.
  useEffect(() => stopBatchPolling, []);

  const startBatchPolling = (batchSessionId: string, batchId: string) => {
    stopBatchPolling();
    batchPollRef.current = setInterval(async () => {
      try {
        const status = await messageApi.getBatchStatus(batchSessionId, batchId);
        setBatchStatus(status);
        if (TERMINAL_BATCH_STATUSES.includes(status.status)) stopBatchPolling();
      } catch {
        // A transient poll failure (network blip, backend restart) must not kill progress tracking.
      }
    }, 2000);
  };

  const handleBulkFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Reject before reading, mirroring the media pick above: FileReader would materialize the whole
    // file as a string before any backend cap could weigh in.
    if (file.size > BULK_RECIPIENTS_FILE_MAX_BYTES) {
      setResponse({
        success: false,
        timestamp: new Date().toISOString(),
        error: t('messageTester.recipientsFileTooLarge'),
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== 'string' || !text.trim()) return;
      setBulkRecipients(prev => (prev.trim() ? `${prev.trimEnd()}\n` : '') + text.trim());
    };
    reader.onerror = () => {
      setResponse({ success: false, timestamp: new Date().toISOString(), error: t('messageTester.fileReadError') });
    };
    reader.readAsText(file);
  };

  const handleCancelBatch = async () => {
    if (!batchStatus || !batchSessionRef.current) return;
    setBatchCancelling(true);
    setBatchError(null);
    try {
      const status = await messageApi.cancelBatch(batchSessionRef.current, batchStatus.batchId);
      setBatchStatus(prev => (prev ? { ...prev, ...status } : prev));
      stopBatchPolling();
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : t('messageTester.sendFailed'));
    } finally {
      setBatchCancelling(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after it's removed
    if (!file) return;
    // Reject before base64-encoding so an oversized pick surfaces a clear error instead of OOMing the tab
    // (the backend 413 cap only applies after the whole body is uploaded).
    if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
      setResponse({ success: false, timestamp: new Date().toISOString(), error: t('messageTester.fileTooLarge') });
      return;
    }
    const myRead = ++mediaReadSeq.current;
    const reader = new FileReader();
    reader.onload = () => {
      // A newer pick, a URL edit, a removal, or an unmount since the read started supersedes
      // these bytes — drop them.
      if (mediaReadSeq.current !== myRead) return;
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') return;
      // readAsDataURL yields "data:<mime>;base64,<payload>"; the engine expects raw base64, so strip the prefix.
      const base64 = dataUrl.split(',')[1] ?? '';
      if (!base64) return;
      setMediaFile({ base64, mimetype: file.type || fallbackMime[messageType], filename: file.name });
      setMediaUrl('');
      if (messageType === 'document') setContent(file.name);
    };
    reader.onerror = () => {
      if (mediaReadSeq.current !== myRead) return;
      setResponse({ success: false, timestamp: new Date().toISOString(), error: t('messageTester.fileReadError') });
    };
    reader.readAsDataURL(file);
  };

  const applyPollFormatting = (formatType: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'monospace') => {
    const textarea = pollQuestionRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = pollQuestion.substring(start, end);

    let newText = '';
    let newStart = start;
    let newEnd = end;

    if (formatType === 'underline') {
      if (selectedText.includes('\u0332')) {
        const unaccented = selectedText.replace(/\u0332/g, '');
        newText = pollQuestion.substring(0, start) + unaccented + pollQuestion.substring(end);
        newStart = start;
        newEnd = start + unaccented.length;
      } else if (selectedText.length > 0) {
        const underlined = selectedText
          .split('')
          .map(char => (char === '\n' || char === ' ' ? char : char + '\u0332'))
          .join('');
        newText = pollQuestion.substring(0, start) + underlined + pollQuestion.substring(end);
        newStart = start;
        newEnd = start + underlined.length;
      } else {
        const placeholder = 'text'
          .split('')
          .map(c => c + '\u0332')
          .join('');
        newText = pollQuestion.substring(0, start) + placeholder + pollQuestion.substring(end);
        newStart = start;
        newEnd = start + placeholder.length;
      }
    } else {
      const markerMap: Record<string, string> = {
        bold: '*',
        italic: '_',
        strikethrough: '~',
        monospace: '```',
      };
      const marker = markerMap[formatType] || '*';
      const markerLen = marker.length;

      if (selectedText.length > 0) {
        if (selectedText.startsWith(marker) && selectedText.endsWith(marker) && selectedText.length >= markerLen * 2) {
          const unwrapped = selectedText.substring(markerLen, selectedText.length - markerLen);
          newText = pollQuestion.substring(0, start) + unwrapped + pollQuestion.substring(end);
          newStart = start;
          newEnd = start + unwrapped.length;
        } else {
          const wrapped = `${marker}${selectedText}${marker}`;
          newText = pollQuestion.substring(0, start) + wrapped + pollQuestion.substring(end);
          newStart = start;
          newEnd = start + wrapped.length;
        }
      } else {
        const placeholder = `${marker}text${marker}`;
        newText = pollQuestion.substring(0, start) + placeholder + pollQuestion.substring(end);
        newStart = start + markerLen;
        newEnd = start + markerLen + 4;
      }
    }

    setPollQuestion(newText);
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newStart, newEnd);
      }
    }, 0);
  };

  const handlePollKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (modKey) {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        applyPollFormatting('bold');
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        applyPollFormatting('italic');
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        applyPollFormatting('underline');
      } else if ((e.shiftKey && (e.key === 'x' || e.key === 'X')) || (e.shiftKey && (e.key === 's' || e.key === 'S'))) {
        e.preventDefault();
        applyPollFormatting('strikethrough');
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        applyPollFormatting('monospace');
      }
    }
  };

  const isMediaMessageType = mediaMessageTypes.includes(messageType);
  const bulkRecipientList = parseBulkRecipients(bulkRecipients);
  const pollOptionsFilled = pollOptions.map(o => o.trim()).filter(o => o.length > 0);
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const delayMs = bulkDelay.trim() === '' ? undefined : parseInt(bulkDelay, 10);

  // Per-type required-field validation for the newer types; text/media keep their original behavior
  // (the backend stays the authoritative validator either way).
  let formValid = true;
  if (isMediaMessageType) {
    if (mediaSourceTab === 'upload') {
      formValid = !!mediaFile;
    } else {
      formValid = mediaUrl.trim().length > 0;
    }
  } else if (messageType === 'location') {
    formValid = !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  } else if (messageType === 'contact') {
    formValid = contactName.trim().length > 0 && contactNumber.trim().length > 0;
  } else if (messageType === 'sticker') {
    formValid = mediaSourceTab === 'upload' ? !!mediaFile : mediaUrl.trim().length > 0;
  } else if (messageType === 'poll') {
    formValid = pollQuestion.trim().length > 0 && pollOptionsFilled.length >= 2;
  } else if (messageType === 'forward') {
    formValid = forwardTo.trim().length > 0 && forwardMessageId.trim().length > 0;
  } else if (messageType === 'bulk') {
    formValid =
      content.trim().length > 0 &&
      bulkRecipientList.length > 0 &&
      bulkRecipientList.length <= BULK_MAX_RECIPIENTS &&
      bulkConfirmedOptIn &&
      (delayMs === undefined || (!Number.isNaN(delayMs) && delayMs >= 1000 && delayMs <= 60000));
  }

  if (isScheduled) {
    formValid = formValid && !!scheduledDateTime && new Date(scheduledDateTime).getTime() > Date.now();
  }

  const isSendDisabled =
    !canWrite ||
    isLoading ||
    !session ||
    !formValid ||
    (messageType !== 'bulk' &&
      (recipientType === 'group'
        ? (isCustomGroup ? !customGroupId.trim() : !selectedGroup)
        : !recipient.trim()));

  const handleSend = async () => {
    const rawGroupId = isCustomGroup ? customGroupId.trim() : selectedGroup;
    const targetId = recipientType === 'group' ? rawGroupId : recipient.trim();
    if (!session || (messageType !== 'bulk' && !targetId)) return;
    setIsLoading(true);
    setResponse(null);
    // An earlier batch keeps running server-side, but its polling must not overwrite this response.
    stopBatchPolling();
    setBatchStatus(null);
    setBatchError(null);

    try {
      // For a personal recipient, let the engine resolve the number to its canonical chat id rather
      // than hand-building an engine-specific JID here (#265) — also surfaces unregistered numbers.
      // Bulk carries its own recipient list, so the shared selector's target is not resolved there.
      let chatId = targetId;
      if (messageType !== 'bulk') {
        if (recipientType === 'group') {
          if (!chatId.endsWith('@g.us')) {
            chatId = `${chatId.replace(/@.*$/, '')}@g.us`;
          }
        } else {
          const resolved = await contactApi.checkNumber(session, targetId.replace(/[^0-9]/g, ''));
          if (!resolved.exists || !resolved.whatsappId) {
            setResponse({
              success: false,
              timestamp: new Date().toISOString(),
              error: t('messageTester.notOnWhatsApp'),
            });
            return;
          }
          chatId = resolved.whatsappId;
        }
      }

      // Bulk is a batch, not a single send: 202 + batchId, then poll progress until terminal.
      if (messageType === 'bulk' && !isScheduled) {
        const batch = await messageApi.sendBulk(session, {
          confirmedOptIn: true,
          messages: bulkRecipientList.map(recipientChatId => ({
            chatId: recipientChatId,
            type: 'text' as const,
            content: { text: content },
          })),
          ...(delayMs !== undefined ? { options: { delayBetweenMessages: delayMs } } : {}),
        });
        batchSessionRef.current = session;
        setResponse({ success: true, timestamp: new Date().toISOString(), batchId: batch.batchId });
        setBatchStatus({
          batchId: batch.batchId,
          status: 'pending',
          progress: { total: batch.totalMessages, sent: 0, failed: 0, pending: batch.totalMessages, cancelled: 0 },
          results: [],
        });
        startBatchPolling(session, batch.batchId);
        return;
      }

      let result: MessageResponse;

      if (isScheduled && scheduledDateTime) {
        const scheduledId = editingScheduledId || `sched_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const existingItem = editingScheduledId
          ? scheduledItems.find(item => item.id === editingScheduledId)
          : undefined;

        let preview = content.trim();
        if (messageType === 'poll') {
          preview = `📊 Poll: ${pollQuestion} (${pollOptionsFilled.join(', ')})`;
        } else if (messageType === 'location') {
          preview = `📍 Location: ${lat}, ${lng}`;
        } else if (messageType === 'contact') {
          preview = `👤 Contact: ${contactName} (${contactNumber})`;
        } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(messageType)) {
          preview = `📎 ${messageType.toUpperCase()}: ${content || mediaUrl || 'Attached file'}`;
        }

        const activeSessionObj = sessions.find(s => s.id === session);

        let newItem: ScheduledItem = {
          id: scheduledId,
          sessionId: session,
          sessionName: activeSessionObj?.name,
          recipient: chatId,
          recipientType,
          messageType,
          scheduledAt: new Date(scheduledDateTime).toISOString(),
          createdAt: existingItem?.createdAt || new Date().toISOString(),
          status: 'pending',
          previewText: preview || `${messageType} message`,
          details: {
            content,
            mediaUrl,
            mediaFile,
            pollQuestion: pollQuestion.trim(),
            pollOptions: pollOptionsFilled,
            allowMultipleAnswers,
            latitude: lat ? String(lat) : undefined,
            longitude: lng ? String(lng) : undefined,
            locationDescription,
            locationAddress,
            contactName,
            contactNumber,
            forwardFrom,
            forwardTo,
            forwardMessageId,
            bulkRecipients,
            bulkDelay,
          },
          recurrence: {
            frequency: recurrence,
            time: recurrenceTime,
            days: recurrenceDays,
            endDate: recurrenceEndDate || undefined,
          },
        };

        // Persist to backend database
        try {
          if (editingScheduledId) {
            const updated = await scheduledMessageApi.update(session, editingScheduledId, {
              recipient: newItem.recipient,
              recipientType: newItem.recipientType,
              messageType: newItem.messageType,
              scheduledAt: newItem.scheduledAt,
              previewText: newItem.previewText,
              details: newItem.details,
              recurrence: newItem.recurrence,
            });
            newItem = {
              ...newItem,
              ...updated,
              messageType: (updated.messageType as any) || newItem.messageType,
              error: updated.error || undefined,
            };
          } else {
            const created = await scheduledMessageApi.create(session, {
              recipient: newItem.recipient,
              recipientType: newItem.recipientType,
              messageType: newItem.messageType,
              scheduledAt: newItem.scheduledAt,
              previewText: newItem.previewText,
              details: newItem.details,
              recurrence: newItem.recurrence,
            });
            newItem.id = created.id;
            newItem.createdAt = created.createdAt;
            newItem.status = created.status;
          }
        } catch (dbErr) {
          throw new Error('Schedule was not saved to the server. Please try again. ' + (dbErr instanceof Error ? dbErr.message : String(dbErr)));
        }

        if (editingScheduledId) {
          updateScheduledItems(prev => prev.map(item => (item.id === editingScheduledId ? newItem : item)));
        } else {
          updateScheduledItems(prev => [newItem, ...prev]);
        }
        selectCalendarDate(new Date(newItem.scheduledAt));
        setEditingScheduledId(null);

        setResponse({
          success: true,
          messageId: newItem.id,
          timestamp: new Date().toISOString(),
        });
        toast.success(editingScheduledId ? 'Schedule updated in database' : 'Message scheduled and saved to database');
        return;
      }

      switch (messageType) {
        case 'text':
          result = await messageApi.sendText(session, chatId, content);
          break;
        case 'image':
        case 'video':
        case 'audio':
        case 'document': {
          // sendMedia unifies URL and base64 (local file) sends; base64 wins when a file is picked. The
          // backend accepts url XOR base64 and requires a mimetype for base64 (always provided here).
          const payload: SendMediaPayload = mediaFile
            ? { base64: mediaFile.base64, mimetype: mediaFile.mimetype }
            : { url: mediaUrl };
          if ((messageType === 'image' || messageType === 'video') && content) payload.caption = content;
          if (messageType === 'document' && content) payload.filename = content;
          result = await messageApi.sendMedia(session, chatId, messageType, payload);
          break;
        }
        case 'sticker': {
          const payload: SendMediaPayload = mediaFile
            ? { base64: mediaFile.base64, mimetype: mediaFile.mimetype }
            : { url: mediaUrl };
          result = await messageApi.sendSticker(session, chatId, payload);
          break;
        }
        case 'location':
          result = await messageApi.sendLocation(session, {
            chatId,
            latitude: lat,
            longitude: lng,
            ...(locationDescription.trim() ? { description: locationDescription.trim() } : {}),
            ...(locationAddress.trim() ? { address: locationAddress.trim() } : {}),
          });
          break;
        case 'contact':
          result = await messageApi.sendContact(session, {
            chatId,
            contactName: contactName.trim(),
            contactNumber: contactNumber.trim(),
          });
          break;
        case 'poll':
          result = await messageApi.sendPoll(session, {
            chatId,
            name: pollQuestion.trim(),
            options: pollOptionsFilled,
            ...(allowMultipleAnswers ? { allowMultipleAnswers: true } : {}),
          });
          break;
        case 'forward': {
          // toChatId passes through as-is when it is a full chat ID; a bare number is resolved
          // through the same check-number flow as the main recipient.
          let toChatId = forwardTo.trim();
          if (!toChatId.includes('@')) {
            const resolvedTo = await contactApi.checkNumber(session, toChatId.replace(/[^0-9]/g, ''));
            if (!resolvedTo.exists || !resolvedTo.whatsappId) {
              setResponse({
                success: false,
                timestamp: new Date().toISOString(),
                error: t('messageTester.notOnWhatsApp'),
              });
              return;
            }
            toChatId = resolvedTo.whatsappId;
          }
          result = await messageApi.forward(session, {
            // An empty fromChatId defaults to the current (already resolved) recipient.
            fromChatId: forwardFrom.trim() || chatId,
            toChatId,
            messageId: forwardMessageId.trim(),
          });
          break;
        }
        default:
          throw new Error(`Unsupported message type: ${messageType}`);
      }

      setResponse({
        success: !!result.messageId,
        messageId: result.messageId,
        timestamp: result.timestamp ? new Date(result.timestamp * 1000).toISOString() : new Date().toISOString(),
      });
    } catch (err) {
      setResponse({
        success: false,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : t('messageTester.sendFailed'),
        status: err instanceof Error ? (err as Error & { status?: number }).status : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const batchPercent =
    batchStatus && batchStatus.progress.total > 0
      ? Math.round(
          ((batchStatus.progress.sent + batchStatus.progress.failed + batchStatus.progress.cancelled) /
            batchStatus.progress.total) *
            100,
        )
      : 0;

  if (loadingSessions) {
    return (
      <div
        className="message-tester"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="message-tester">
      <PageHeader title={t('messageTester.title')} subtitle={t('messageTester.subtitle')} />

      <div className="tester-panels">
        <div className="compose-panel" ref={composePanelRef}>
          <h2 className="eyebrow">{t('messageTester.compose')}</h2>

          {editingScheduledId && (
            <div className="schedule-edit-banner">
              <span>
                <Pencil size={14} /> Editing scheduled message
              </span>
              <div className="schedule-edit-banner-actions">
                <button
                  type="button"
                  className="btn-banner-duplicate"
                  onClick={() => {
                    setEditingScheduledId(null);
                    toast.info('Now composing as a new message. Click "Schedule Message" to save as a duplicate.');
                  }}
                  title="Save as a new message instead of updating the original"
                >
                  <Copy size={13} />
                  <span>Duplicate as New</span>
                </button>
                <button type="button" onClick={() => setEditingScheduledId(null)}>
                  Stop editing
                </button>
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="mt-1">{t('messageTester.session')}</label>
            <select id="mt-1" value={session} onChange={e => setSession(e.target.value)}>
              {sessions.length === 0 && <option value="">{t('messageTester.noReadySessions')}</option>}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.phone || t('messageTester.sessionOptionPhoneNone')})
                </option>
              ))}
            </select>
          </div>

          {/* Bulk carries its own recipient list, so the single-recipient selector is hidden there. */}
          {messageType !== 'bulk' && (
            <>
              <div className="form-group">
                {/* A caption, not a label: it names the group, and there is no single control to bind
                    it to. The buttons are exclusive choices, so each reports its own pressed state. */}
                <span className="group-label" id="recipient-type-label">
                  {t('messageTester.recipientType')}
                </span>
                <div className="toggle-group" role="group" aria-labelledby="recipient-type-label">
                  <button
                    type="button"
                    aria-pressed={recipientType === 'personal'}
                    className={recipientType === 'personal' ? 'active' : ''}
                    onClick={() => setRecipientType('personal')}
                  >
                    {t('messageTester.personal')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={recipientType === 'group'}
                    className={recipientType === 'group' ? 'active' : ''}
                    onClick={() => setRecipientType('group')}
                  >
                    {t('messageTester.group')}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <div className="group-label-row">
                  <label htmlFor="mt-13">
                    {recipientType === 'group' ? t('messageTester.selectGroup') : t('messageTester.recipientPhone')}
                  </label>
                  {recipientType === 'group' && (
                    <div className="group-sub-toggle">
                      <button
                        type="button"
                        className={`group-sub-tab ${!isCustomGroup ? 'active' : ''}`}
                        onClick={() => setIsCustomGroup(false)}
                      >
                        From List
                      </button>
                      <button
                        type="button"
                        className={`group-sub-tab ${isCustomGroup ? 'active' : ''}`}
                        onClick={() => setIsCustomGroup(true)}
                      >
                        Custom Group ID
                      </button>
                    </div>
                  )}
                </div>
                {recipientType === 'group' ? (
                  isCustomGroup ? (
                    <div className="custom-group-input-wrap">
                      <input
                        type="text"
                        id="mt-13"
                        className="input-field"
                        placeholder="e.g. 120363024567890123@g.us"
                        value={customGroupId}
                        onChange={e => setCustomGroupId(e.target.value)}
                      />
                      <span className="hint">Enter WhatsApp Group JID (e.g. 120363...@g.us)</span>
                    </div>
                  ) : (
                    <>
                      <div className="searchable-group-picker" ref={groupDropdownRef}>
                        <button
                          type="button"
                          id="mt-13"
                          className={`group-picker-trigger ${isGroupDropdownOpen ? 'open' : ''}`}
                          onClick={() => setIsGroupDropdownOpen(prev => !prev)}
                          disabled={loadingGroups || groups.length === 0}
                          aria-haspopup="listbox"
                          aria-expanded={isGroupDropdownOpen}
                        >
                          <div className="group-picker-trigger-content">
                            <Users size={16} className="group-picker-icon" />
                            <div className="group-picker-labels">
                              <span className="group-picker-name">
                                {loadingGroups
                                  ? t('messageTester.loadingGroups')
                                  : groups.length === 0
                                    ? t('messageTester.noGroupsFound')
                                    : selectedGroupObj
                                      ? selectedGroupObj.name
                                      : t('messageTester.selectGroup')}
                              </span>
                              {selectedGroupObj && (
                                <span className="group-picker-subtext">
                                  {selectedGroupObj.id}
                                  {selectedGroupObj.effectiveTimestamp > 0 &&
                                    ` • Active ${formatRelativeTime(selectedGroupObj.effectiveTimestamp)}`}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronDown
                            size={16}
                            className={`group-picker-chevron ${isGroupDropdownOpen ? 'rotated' : ''}`}
                          />
                        </button>

                        {isGroupDropdownOpen && (
                          <div className="group-picker-dropdown" role="listbox">
                            <div className="group-picker-search-header">
                              <Search size={14} className="group-picker-search-icon" />
                              <input
                                type="text"
                                className="group-picker-search-input"
                                placeholder="Search groups..."
                                value={groupSearch}
                                onChange={e => setGroupSearch(e.target.value)}
                                autoFocus
                                onClick={e => e.stopPropagation()}
                              />
                              {groupSearch && (
                                <button
                                  type="button"
                                  className="group-picker-clear-search"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setGroupSearch('');
                                  }}
                                >
                                  <X size={13} />
                                </button>
                              )}
                              <span className="group-picker-count-badge">{filteredGroups.length}</span>
                            </div>

                            <div className="group-picker-options-list">
                              {filteredGroups.length === 0 ? (
                                <div className="group-picker-empty">
                                  <span>No groups matching &ldquo;{groupSearch}&rdquo;</span>
                                  {groupSearch && (
                                    <button
                                      type="button"
                                      className="group-picker-reset-btn"
                                      onClick={() => setGroupSearch('')}
                                    >
                                      Clear search
                                    </button>
                                  )}
                                </div>
                              ) : (
                                filteredGroups.map((g, idx) => {
                                  const isSelected = g.id === selectedGroup;
                                  const relTime = formatRelativeTime(g.effectiveTimestamp);
                                  const isMostRecent = idx === 0 && g.effectiveTimestamp > 0;
                                  return (
                                    <div
                                      key={g.id}
                                      role="option"
                                      aria-selected={isSelected}
                                      className={`group-picker-option ${isSelected ? 'selected' : ''}`}
                                      onClick={() => {
                                        setSelectedGroup(g.id);
                                        setIsGroupDropdownOpen(false);
                                      }}
                                    >
                                      <div className="group-option-info">
                                        <div className="group-option-title-row">
                                          <span className="group-option-name">{g.name}</span>
                                          {isMostRecent && <span className="recent-badge">Most Recent</span>}
                                        </div>
                                        <div className="group-option-meta">
                                          <span className="group-option-id">{g.id}</span>
                                          {relTime && (
                                            <span className="group-option-time">
                                              <Clock size={11} />
                                              {relTime}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {isSelected && <Check size={16} className="group-option-check" />}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Hidden native select for accessibility/testing parity */}
                      <select
                        value={selectedGroup}
                        onChange={e => setSelectedGroup(e.target.value)}
                        style={{ display: 'none' }}
                        aria-hidden="true"
                        tabIndex={-1}
                      >
                        {sortedGroups.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      <span className="hint">{t('messageTester.selectGroupHint')}</span>
                    </>
                  )
                ) : (
                  <>
                    <input
                      type="text"
                      value={recipient}
                      onChange={e => setRecipient(e.target.value)}
                      placeholder="+62812345678"
                    />
                    <span className="hint">{t('messageTester.phoneHint')}</span>
                  </>
                )}
              </div>
            </>
          )}

          <div className="form-group">
            <span className="group-label" id="message-type-label">
              {t('messageTester.messageType')}
            </span>
            <div className="toggle-group toggle-group-wrap" role="group" aria-labelledby="message-type-label">
              {messageTypes.map(type => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={messageType === type}
                  className={messageType === type ? 'active' : ''}
                  onClick={() => {
                    // A picked file's mimetype is bound to the category active at pick time, so dropping the
                    // category would route stale bytes to the wrong send-${type} endpoint — clear it.
                    if (type !== messageType) clearMediaFile();
                    setMessageType(type);
                  }}
                >
                  {t(`messageTester.types.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {messageType === 'text' && (
            <div className="form-group">
              <label htmlFor="mt-2">{t('messageTester.messageContent')}</label>
              <textarea
                id="mt-2"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={t('messageTester.messagePlaceholder')}
                rows={5}
              />
            </div>
          )}

          {isMediaMessageType && (
            <>
              <div className="form-group">
                <span className="group-label" id="media-source-label">
                  {t('messageTester.mediaSource')}
                </span>
                <div className="toggle-group" role="group" aria-labelledby="media-source-label">
                  <button
                    type="button"
                    aria-pressed={mediaSourceTab === 'upload'}
                    className={mediaSourceTab === 'upload' ? 'active' : ''}
                    onClick={() => {
                      setMediaSourceTab('upload');
                      setMediaUrl('');
                    }}
                  >
                    <Upload size={14} /> {t('messageTester.uploadTab')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={mediaSourceTab === 'url'}
                    className={mediaSourceTab === 'url' ? 'active' : ''}
                    onClick={() => {
                      setMediaSourceTab('url');
                      clearMediaFile();
                    }}
                  >
                    <Globe size={14} /> {t('messageTester.urlTab')}
                  </button>
                </div>
              </div>

              {mediaSourceTab === 'upload' ? (
                <div className="form-group">
                  <label id="upload-file-label">{t('messageTester.uploadFile')}</label>
                  {mediaFile ? (
                    <div className="file-selected">
                      <div className="file-info-group">
                        <FileText size={18} className="file-icon" />
                        <span className="file-name" title={mediaFile.filename}>
                          {mediaFile.filename}
                        </span>
                      </div>
                      <button type="button" className="remove-file-btn" onClick={clearMediaFile}>
                        <X size={14} /> {t('messageTester.removeFile')}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="upload-dropzone"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        if (e.dataTransfer.files?.[0]) {
                          const fakeEvent = {
                            target: { files: e.dataTransfer.files, value: '' },
                          } as unknown as ChangeEvent<HTMLInputElement>;
                          handleFileChange(fakeEvent);
                        }
                      }}
                    >
                      <Upload size={24} className="dropzone-icon" />
                      <span className="dropzone-text">{t('messageTester.dragDropHint')}</span>
                      <button
                        type="button"
                        className="browse-btn"
                        onClick={e => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        <Upload size={14} /> {t('messageTester.browse')}
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    accept={mediaAccept[messageType]}
                    onChange={handleFileChange}
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label htmlFor="mt-3">{t('messageTester.mediaUrl')}</label>
                  <input
                    id="mt-3"
                    type="text"
                    value={mediaUrl}
                    onChange={e => {
                      setMediaUrl(e.target.value);
                      mediaReadSeq.current += 1;
                      if (mediaFile) setMediaFile(null);
                    }}
                    placeholder="https://example.com/file.jpg"
                  />
                </div>
              )}

              {messageType !== 'audio' && messageType !== 'sticker' && (
                <div className="form-group">
                  <label htmlFor="mt-14">
                    {messageType === 'document' ? t('messageTester.filename') : t('messageTester.caption')} (
                    {t('common.optional')})
                  </label>
                  <input
                    id="mt-14"
                    type="text"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder={
                      messageType === 'document'
                        ? t('messageTester.filenamePlaceholder')
                        : t('messageTester.captionPlaceholder')
                    }
                  />
                </div>
              )}
            </>
          )}

          {messageType === 'location' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="mt-4">{t('messageTester.locationLatitude')}</label>
                  <input
                    id="mt-4"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={latitude}
                    onChange={e => setLatitude(e.target.value)}
                    placeholder="-6.2088"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="mt-5">{t('messageTester.locationLongitude')}</label>
                  <input
                    id="mt-5"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={longitude}
                    onChange={e => setLongitude(e.target.value)}
                    placeholder="106.8456"
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="mt-15">
                  {t('messageTester.locationDescription')} ({t('common.optional')})
                </label>
                <input
                  id="mt-15"
                  type="text"
                  value={locationDescription}
                  onChange={e => setLocationDescription(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="mt-16">
                  {t('messageTester.locationAddress')} ({t('common.optional')})
                </label>
                <input
                  id="mt-16"
                  type="text"
                  value={locationAddress}
                  onChange={e => setLocationAddress(e.target.value)}
                />
              </div>
            </>
          )}

          {messageType === 'contact' && (
            <>
              <div className="form-group">
                <label htmlFor="mt-6">{t('messageTester.contactName')}</label>
                <input
                  id="mt-6"
                  type="text"
                  value={contactName}
                  onChange={e => setContactName(e.target.value)}
                  placeholder={t('messageTester.contactNamePlaceholder')}
                />
              </div>
              <div className="form-group">
                <label htmlFor="mt-7">{t('messageTester.contactNumber')}</label>
                <input
                  id="mt-7"
                  type="text"
                  value={contactNumber}
                  onChange={e => setContactNumber(e.target.value)}
                  placeholder="+62812345678"
                />
              </div>
            </>
          )}

          {messageType === 'poll' && (
            <>
              <div className="form-group">
                <div className="poll-question-header">
                  <label htmlFor="mt-8">{t('messageTester.pollQuestion')}</label>
                  <span className={`poll-char-count ${pollQuestion.length > 240 ? 'warning' : ''}`}>
                    {pollQuestion.length}/255
                  </span>
                </div>
                <div className="poll-editor-container">
                  <div className="poll-format-toolbar" role="toolbar" aria-label="Text formatting">
                    <div className="toolbar-btn-group">
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => applyPollFormatting('bold')}
                        title="Bold (*text*) • Ctrl+B"
                        aria-label="Format bold"
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => applyPollFormatting('italic')}
                        title="Italic (_text_) • Ctrl+I"
                        aria-label="Format italic"
                      >
                        <Italic size={14} />
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => applyPollFormatting('underline')}
                        title="Underline (u̲n̲d̲e̲r̲l̲i̲n̲e̲) • Ctrl+U"
                        aria-label="Format underline"
                      >
                        <Underline size={14} />
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => applyPollFormatting('strikethrough')}
                        title="Strikethrough (~text~) • Ctrl+Shift+S"
                        aria-label="Format strikethrough"
                      >
                        <Strikethrough size={14} />
                      </button>
                      <button
                        type="button"
                        className="format-btn"
                        onClick={() => applyPollFormatting('monospace')}
                        title="Monospace (```text```) • Ctrl+E"
                        aria-label="Format monospace"
                      >
                        <Code size={14} />
                      </button>
                    </div>
                    <span className="toolbar-hint">WhatsApp Markdown</span>
                  </div>
                  <textarea
                    id="mt-8"
                    ref={pollQuestionRef}
                    className="poll-question-textarea"
                    rows={4}
                    value={pollQuestion}
                    onChange={e => setPollQuestion(e.target.value)}
                    onKeyDown={handlePollKeyDown}
                    placeholder={t('messageTester.pollQuestionPlaceholder')}
                    maxLength={255}
                  />
                </div>
                <span className="hint">
                  Press <strong>Enter</strong> to go to next line. Supports WhatsApp formatting: *bold*, _italic_,
                  ~strikethrough~, u̲n̲d̲e̲r̲l̲i̲n̲e̲.
                </span>
              </div>
              <div className="form-group">
                <label>{t('messageTester.pollOptions')}</label>
                {pollOptions.map((option, index) => (
                  <div className="poll-option-row" key={index}>
                    <input
                      type="text"
                      value={option}
                      onChange={e => setPollOptions(prev => prev.map((o, i) => (i === index ? e.target.value : o)))}
                      placeholder={t('messageTester.pollOptionPlaceholder', { index: index + 1 })}
                    />
                    <button
                      type="button"
                      className="remove-option-btn"
                      onClick={() => setPollOptions(prev => prev.filter((_, i) => i !== index))}
                      disabled={pollOptions.length <= 2}
                      aria-label={t('messageTester.removeOption')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="add-option-btn"
                  onClick={() => setPollOptions(prev => [...prev, ''])}
                  disabled={pollOptions.length >= 12}
                >
                  <Plus size={14} /> {t('messageTester.addOption')}
                </button>
                <span className="hint">{t('messageTester.pollOptionsHint')}</span>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowMultipleAnswers}
                    onChange={e => setAllowMultipleAnswers(e.target.checked)}
                  />
                  {t('messageTester.allowMultipleAnswers')}
                </label>
              </div>
            </>
          )}

          {messageType === 'forward' && (
            <>
              <div className="form-group">
                <label htmlFor="mt-17">
                  {t('messageTester.forwardFromChatId')} ({t('common.optional')})
                </label>
                <input
                  id="mt-17"
                  type="text"
                  value={forwardFrom}
                  onChange={e => setForwardFrom(e.target.value)}
                  placeholder={
                    (recipientType === 'group' ? selectedGroup : recipient) || t('messageTester.forwardFromPlaceholder')
                  }
                />
                <span className="hint">{t('messageTester.forwardFromHint')}</span>
              </div>
              <div className="form-group">
                <label htmlFor="mt-9">{t('messageTester.forwardToChatId')}</label>
                <input
                  id="mt-9"
                  type="text"
                  value={forwardTo}
                  onChange={e => setForwardTo(e.target.value)}
                  placeholder={t('messageTester.forwardToPlaceholder')}
                />
              </div>
              <div className="form-group">
                <label htmlFor="mt-10">{t('messageTester.forwardMessageId')}</label>
                <input
                  id="mt-10"
                  type="text"
                  value={forwardMessageId}
                  onChange={e => setForwardMessageId(e.target.value)}
                />
                <span className="hint">{t('messageTester.forwardMessageIdHint')}</span>
              </div>
            </>
          )}

          {messageType === 'bulk' && (
            <>
              <div className="form-group">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <label htmlFor="mt-11" style={{ marginBottom: 0 }}>
                    {t('messageTester.bulkRecipients')}
                  </label>
                  <button type="button" className="browse-btn" onClick={() => bulkFileInputRef.current?.click()}>
                    <Upload size={14} /> {t('messageTester.bulkRecipientsUpload')}
                  </button>
                  <input
                    ref={bulkFileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    style={{ display: 'none' }}
                    onChange={handleBulkFileChange}
                  />
                </div>
                <textarea
                  id="mt-11"
                  value={bulkRecipients}
                  onChange={e => setBulkRecipients(e.target.value)}
                  placeholder={t('messageTester.bulkRecipientsPlaceholder')}
                  rows={4}
                />
                <span className="hint">
                  {t('messageTester.bulkRecipientsHint')} ·{' '}
                  {t('messageTester.bulkRecipientsCount', { count: bulkRecipientList.length })}
                </span>
              </div>
              <div className="form-group">
                <label htmlFor="mt-12">{t('messageTester.messageContent')}</label>
                <textarea
                  id="mt-12"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder={t('messageTester.messagePlaceholder')}
                  rows={4}
                />
              </div>
              <div className="form-group">
                <label htmlFor="mt-18">
                  {t('messageTester.bulkDelay')} ({t('common.optional')})
                </label>
                <input
                  id="mt-18"
                  type="number"
                  min={1000}
                  max={60000}
                  step={500}
                  value={bulkDelay}
                  onChange={e => setBulkDelay(e.target.value)}
                  placeholder="3000"
                />
                <span className="hint">{t('messageTester.bulkDelayHint')}</span>
              </div>
              <div className="form-group">
                <label className="checkbox-label" htmlFor="mt-bulk-consent-check">
                  <input
                    id="mt-bulk-consent-check"
                    type="checkbox"
                    checked={bulkConfirmedOptIn}
                    onChange={e => setBulkConfirmedOptIn(e.target.checked)}
                  />
                  I confirm every recipient explicitly opted in to receive this broadcast.
                </label>
                <span className="hint">Purchased, scraped and unknown contact lists must not be used.</span>
              </div>
            </>
          )}

          <div className="form-group schedule-box">
            <label className="checkbox-label" htmlFor="mt-schedule-check">
              <input
                id="mt-schedule-check"
                type="checkbox"
                checked={isScheduled}
                onChange={e => {
                  setIsScheduled(e.target.checked);
                  if (!e.target.checked) {
                    setScheduledDateTime('');
                    setEditingScheduledId(null);
                  }
                }}
              />
              <Clock size={16} />
              <span>{t('messageTester.scheduleSend')}</span>
            </label>
            {isScheduled && (
              <div className="schedule-time-row">
                <label htmlFor="mt-schedule-time">{t('messageTester.scheduleTime')}</label>
                <input
                  id="mt-schedule-time"
                  type="datetime-local"
                  value={scheduledDateTime}
                  min={toLocalDateTimeInput(new Date(Date.now() + 60000))}
                  onChange={e => setScheduledDateTime(e.target.value)}
                  required
                />
                <span className="hint">{t('messageTester.scheduleSendHint')}</span>
                <div className="recurrence-panel">
                  <label htmlFor="mt-recurrence">Repeat</label>
                  <select
                    id="mt-recurrence"
                    value={recurrence}
                    onChange={e => setRecurrence(e.target.value as typeof recurrence)}
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select>
                  {recurrence !== 'none' && (
                    <>
                      <label htmlFor="mt-repeat-time">Send time</label>
                      <input
                        id="mt-repeat-time"
                        type="time"
                        value={recurrenceTime}
                        onChange={e => setRecurrenceTime(e.target.value)}
                      />
                      {recurrence === 'weekly' && (
                        <div className="weekday-picker" aria-label="Repeat on days">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                            <button
                              key={day}
                              type="button"
                              className={recurrenceDays.includes(index) ? 'active' : ''}
                              onClick={() =>
                                setRecurrenceDays(days =>
                                  days.includes(index) ? days.filter(d => d !== index) : [...days, index].sort(),
                                )
                              }
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      )}
                      <label htmlFor="mt-repeat-end">
                        End date <span>(optional)</span>
                      </label>
                      <input
                        id="mt-repeat-end"
                        type="date"
                        value={recurrenceEndDate}
                        onChange={e => setRecurrenceEndDate(e.target.value)}
                        min={scheduledDateTime.slice(0, 10)}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <button className="send-btn" onClick={handleSend} disabled={isSendDisabled}>
            {isLoading ? (
              <Loader2 className="animate-spin" size={18} />
            ) : isScheduled ? (
              <Clock size={18} />
            ) : (
              <Send size={18} />
            )}
            {isLoading
              ? t('messageTester.sending')
              : isScheduled
                ? editingScheduledId
                  ? 'Update Schedule'
                  : t('messageTester.scheduleSend')
                : canWrite
                  ? t('messageTester.send')
                  : t('messageTester.viewOnly')}
          </button>
        </div>

        <div className="response-panel">
          <h2 className="eyebrow">{t('messageTester.responseTitle')}</h2>

          {response ? (
            <>
              <div className={`response-status ${response.success ? 'success' : 'error'}`}>
                {response.success ? (
                  <>
                    <CheckCircle size={20} />
                    <span>{t('messageTester.successLabel')}</span>
                  </>
                ) : (
                  <>
                    <XCircle size={20} />
                    <span>{t('messageTester.failedLabel')}</span>
                  </>
                )}
                {/* `<code>` earns both halves from index.css with no new rule: a monospace face, and the
                    LTR isolation that stops the bidi algorithm reordering the number against an RTL label
                    (ar/he). The `.mono` class only carries the second — its monospacing lives on compound
                    selectors like `.detail-value.mono`, which a bare span never matches. */}
                {response.status !== undefined && <code>HTTP {response.status}</code>}
              </div>

              <div className="response-details">
                <div className="detail-row">
                  <span className="detail-label">{t('messageTester.response.timestamp')}</span>
                  <span className="detail-value">{response.timestamp}</span>
                </div>
                {response.messageId && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.messageId')}</span>
                    <span className="detail-value mono">{response.messageId}</span>
                  </div>
                )}
                {response.batchId && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.batchId')}</span>
                    <span className="detail-value mono">{response.batchId}</span>
                  </div>
                )}
                {response.error && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.error')}</span>
                    <span className="detail-value" style={{ color: 'var(--error)' }}>
                      {response.error}
                    </span>
                  </div>
                )}
              </div>

              {response.batchId && batchStatus && response.batchId === batchStatus.batchId && (
                <div className="batch-status">
                  <div className="batch-status-row">
                    <span className={`batch-badge ${batchStatus.status}`}>
                      {t(`messageTester.batch.status.${batchStatus.status}`)}
                    </span>
                    {(batchStatus.status === 'pending' || batchStatus.status === 'processing') && (
                      <button
                        type="button"
                        className="batch-cancel-btn"
                        onClick={handleCancelBatch}
                        disabled={batchCancelling}
                      >
                        {batchCancelling ? t('messageTester.batch.cancelling') : t('messageTester.batch.cancel')}
                      </button>
                    )}
                  </div>
                  <div className="batch-progress-bar">
                    <div className="batch-progress-fill" style={{ width: `${batchPercent}%` }} />
                  </div>
                  <div className="batch-progress-line">
                    {t('messageTester.batch.progress', {
                      sent: batchStatus.progress.sent,
                      failed: batchStatus.progress.failed,
                      pending: batchStatus.progress.pending,
                      total: batchStatus.progress.total,
                    })}
                  </div>
                  {batchError && <div className="batch-error">{batchError}</div>}
                </div>
              )}

              <div className="response-json">
                <pre>{JSON.stringify(response, null, 2)}</pre>
              </div>
            </>
          ) : (
            <div className="response-empty">
              <p>{t('messageTester.responseEmpty')}</p>
            </div>
          )}

          {/* Scheduled Messages & Polls Queue (Live Side Panel) */}
          <div className="scheduled-queue-container">
            <div className="scheduled-queue-header">
              <div className="queue-title">
                <Calendar size={18} className="queue-icon" />
                <h3>Scheduled Queue ({scheduledItems.filter(i => i.status === 'pending').length} Pending)</h3>
              </div>
              {scheduledItems.length > 0 && (
                <button
                  type="button"
                  className="btn-clear-history"
                  onClick={() => {
                    if (confirm('Clear completed and cancelled scheduled items?')) {
                      updateScheduledItems(prev => prev.filter(i => i.status === 'pending'));
                    }
                  }}
                  title="Clear completed/cancelled history"
                >
                  Clear Done
                </button>
              )}
            </div>

            <p className="form-hint" role="status">
              {scheduledItems.some(item => item.status === 'pending' && item.id.startsWith('sched_'))
                ? 'Some older schedules are still being saved to the server. Keep this page open until this notice clears.'
                : 'Saved schedules run on the server, even when your browser is closed.'}
            </p>
            <div className="queue-view-mode-tabs">
              <button
                type="button"
                className={`view-mode-tab ${queueTab === 'all' ? 'active' : ''}`}
                onClick={() => setQueueTab('all')}
              >
                All Scheduled ({scheduledItems.length})
              </button>
              <button
                type="button"
                className={`view-mode-tab ${queueTab === 'calendar' ? 'active' : ''}`}
                onClick={() => setQueueTab('calendar')}
              >
                Calendar View
              </button>
            </div>

            <div className="queue-status-filters">
              {(['all', 'pending', 'sent', 'failed'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  className={`status-filter-chip ${statusFilter === st ? 'active' : ''}`}
                  onClick={() => setStatusFilter(st)}
                >
                  {st === 'all' ? 'All Status' : st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>

            {queueTab === 'calendar' ? (
              <>
                <div className="schedule-calendar" aria-label="Scheduled message calendar">
                  <div className="calendar-toolbar">
                    <button
                      type="button"
                      className="calendar-nav-btn"
                      onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                      aria-label="Previous month"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <strong>{calendarMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
                    <div className="calendar-toolbar-actions">
                      <button type="button" className="calendar-today-btn" onClick={() => selectCalendarDate(new Date())}>
                        Today
                      </button>
                      <button
                        type="button"
                        className="calendar-nav-btn"
                        onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                        aria-label="Next month"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="calendar-grid calendar-weekdays" aria-hidden="true">
                    {calendarWeekdays.map(day => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                  <div className="calendar-grid calendar-days">
                    {calendarDays.map((date, index) => {
                      if (!date) return <span key={`blank-${index}`} className="calendar-day-blank" />;
                      const dateKey = toLocalDateKey(date);
                      const items = scheduledItemsByDate.get(dateKey) || [];
                      const pendingCount = items.filter(item => item.status === 'pending').length;
                      const isSelected = dateKey === selectedCalendarDate;
                      const isToday = dateKey === toLocalDateKey(new Date());
                      return (
                        <button
                          type="button"
                          key={dateKey}
                          className={`calendar-day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}${items.length ? ' has-items' : ''}`}
                          onClick={() => selectCalendarDate(date)}
                          aria-pressed={isSelected}
                          aria-label={`${date.toLocaleDateString()}${pendingCount ? `, ${pendingCount} pending messages` : ', no pending messages'}`}
                        >
                          <span className="calendar-day-number">{date.getDate()}</span>
                          {pendingCount > 0 && <span className="calendar-count">{pendingCount}</span>}
                          {pendingCount === 0 && items.length > 0 && <span className="calendar-history-dot" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="selected-day-heading">
                  <div>
                    <strong>
                      {fromLocalDateKey(selectedCalendarDate).toLocaleDateString([], {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </strong>
                    <span>
                      {selectedDayItems.length} {selectedDayItems.length === 1 ? 'message' : 'messages'}
                    </span>
                  </div>
                  <div className="selected-day-actions">
                    <span className="selected-day-pending">
                      {selectedDayItems.filter(item => item.status === 'pending').length} pending
                    </span>
                    {fromLocalDateKey(selectedCalendarDate) >=
                      new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) && (
                      <button
                        type="button"
                        className="btn-new-schedule"
                        onClick={() => startNewScheduleForDate(selectedCalendarDate)}
                      >
                        <Plus size={14} /> New Schedule
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="selected-day-heading">
                <div>
                  <strong>All Scheduled Messages & Polls</strong>
                  <span>
                    {displayedItems.length} {displayedItems.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <div className="selected-day-actions">
                  <span className="selected-day-pending">
                    {displayedItems.filter(item => item.status === 'pending').length} pending
                  </span>
                </div>
              </div>
            )}

            {scheduledItems.length === 0 ? (
              <div className="queue-empty">
                <Clock size={28} className="queue-empty-icon" />
                <p>No messages or polls currently scheduled. Saved schedules run on the server even when your browser is closed.</p>
                <small>Check "Schedule Send" in the composer to queue messages or polls for future delivery.</small>
              </div>
            ) : displayedItems.length === 0 ? (
              <div className="queue-empty queue-empty-day">
                <Calendar size={26} className="queue-empty-icon" />
                <p>{queueTab === 'calendar' ? 'No messages scheduled for this day.' : 'No messages match the selected filter.'}</p>
                <small>
                  {queueTab === 'calendar'
                    ? 'Select a highlighted date to view its scheduled messages, or switch to "All Scheduled".'
                    : 'Try selecting "All Status" above to see all scheduled messages.'}
                </small>
              </div>
            ) : (
              <div className="scheduled-items-list">
                {displayedItems.map(item => {
                  const scheduledDate = new Date(item.scheduledAt);
                  const isPending = item.status === 'pending';
                  const isPast = scheduledDate.getTime() < Date.now();

                  return (
                    <div key={item.id} className={`scheduled-item-card status-${item.status}`}>
                      <div className="item-card-top">
                        <div className="item-badge-group">
                          <span className={`type-badge type-${item.messageType}`}>
                            {item.messageType === 'poll' && <BarChart2 size={12} />}
                            {item.messageType === 'text' && <FileText size={12} />}
                            {['image', 'video', 'document', 'audio', 'sticker'].includes(item.messageType) && (
                              <ImageIcon size={12} />
                            )}
                            {item.messageType === 'location' && <MapPin size={12} />}
                            {item.messageType === 'contact' && <User size={12} />}
                            {item.messageType === 'forward' && <Share2 size={12} />}
                            {item.messageType === 'bulk' && <Layers size={12} />}
                            <span>{item.messageType.toUpperCase()}</span>
                          </span>
                          <span className={`status-pill pill-${item.status}`}>
                            {item.status === 'pending'
                              ? isPast
                                ? 'Sending now...'
                                : 'Scheduled'
                              : item.status === 'sent'
                                ? 'Done'
                                : item.status}
                          </span>
                          {item.recurrence && item.recurrence.frequency !== 'none' && (
                            <span className="repeat-label">↻ {item.recurrence.frequency}</span>
                          )}
                        </div>

                        <div className="scheduled-item-actions">
                          {isPending && (
                            <button
                              type="button"
                              className="btn-send-now-schedule"
                              onClick={() => handleSendNow(item)}
                              title="Send this scheduled message immediately"
                            >
                              <Play size={13} />
                              <span>Send Now</span>
                            </button>
                          )}
                          {isPending && (
                            <button
                              type="button"
                              className="btn-edit-schedule"
                              onClick={() => editScheduledItem(item)}
                              title="Edit this scheduled send"
                            >
                              <Pencil size={14} />
                              <span>Edit</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-duplicate-schedule"
                            onClick={() => duplicateScheduledItem(item)}
                            title="Duplicate this message"
                          >
                            <Copy size={14} />
                            <span>Duplicate</span>
                          </button>
                          {isPending && (
                            <button
                              type="button"
                              className="btn-cancel-schedule"
                              onClick={() => cancelScheduledItem(item.id)}
                              title="Cancel this scheduled send"
                            >
                              <Trash2 size={14} />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="item-preview">{item.previewText}</div>

                      <div className="item-meta">
                        <div className="meta-row">
                          <Clock size={12} />
                          <span>
                            <strong>When:</strong>{' '}
                            {scheduledDate.toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="meta-row">
                          {item.recipientType === 'group' ? <Users size={12} /> : <User size={12} />}
                          <span>
                            <strong>To:</strong> {item.recipient} {item.recipientType === 'group' && <span className="group-flag">(Group)</span>}
                          </span>
                        </div>
                      </div>

                      {item.error && <div className="item-error-msg">Error: {item.error}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Storage utility for pinned/favorite WhatsApp groups and contacts

export interface PinnedContact {
  phone: string;
  name?: string;
}

export const FAVORITE_STORAGE_KEYS = {
  PINNED_GROUPS: 'waply_pinned_groups',
  PINNED_CONTACTS: 'waply_pinned_contacts',
} as const;

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('waply_favorites_changed'));
    }
  } catch {
    // Ignore storage errors
  }
}

/** Get list of pinned WhatsApp group JIDs (e.g. 120363...@g.us) */
export function getPinnedGroupIds(): string[] {
  const raw = safeGet(FAVORITE_STORAGE_KEYS.PINNED_GROUPS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Check if a group is pinned */
export function isGroupPinned(groupId: string): boolean {
  if (!groupId) return false;
  return getPinnedGroupIds().includes(groupId);
}

/** Toggle pin state for a group. Returns true if newly pinned, false if unpinned. */
export function togglePinGroup(groupId: string): boolean {
  if (!groupId) return false;
  const current = getPinnedGroupIds();
  const exists = current.includes(groupId);
  const updated = exists ? current.filter(id => id !== groupId) : [...current, groupId];
  safeSet(FAVORITE_STORAGE_KEYS.PINNED_GROUPS, JSON.stringify(updated));
  return !exists;
}

/** Get list of pinned personal contacts */
export function getPinnedContacts(): PinnedContact[] {
  const raw = safeGet(FAVORITE_STORAGE_KEYS.PINNED_CONTACTS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Check if a contact phone number is pinned */
export function isContactPinned(phone: string): boolean {
  if (!phone) return false;
  const normalized = phone.replace(/[^0-9]/g, '');
  if (!normalized) return false;
  return getPinnedContacts().some(c => c.phone.replace(/[^0-9]/g, '') === normalized);
}

/** Toggle pin state for a contact */
export function togglePinContact(contact: PinnedContact): boolean {
  if (!contact?.phone) return false;
  const current = getPinnedContacts();
  const normalized = contact.phone.replace(/[^0-9]/g, '');
  if (!normalized) return false;

  const exists = current.some(c => c.phone.replace(/[^0-9]/g, '') === normalized);
  let updated: PinnedContact[];
  if (exists) {
    updated = current.filter(c => c.phone.replace(/[^0-9]/g, '') !== normalized);
  } else {
    const label = contact.name?.trim() || contact.phone.trim();
    updated = [...current, { phone: contact.phone.trim(), name: label }];
  }
  safeSet(FAVORITE_STORAGE_KEYS.PINNED_CONTACTS, JSON.stringify(updated));
  return !exists;
}

/** Remove a pinned contact by phone */
export function removePinnedContact(phone: string): void {
  if (!phone) return;
  const current = getPinnedContacts();
  const normalized = phone.replace(/[^0-9]/g, '');
  const updated = current.filter(c => c.phone.replace(/[^0-9]/g, '') !== normalized);
  safeSet(FAVORITE_STORAGE_KEYS.PINNED_CONTACTS, JSON.stringify(updated));
}

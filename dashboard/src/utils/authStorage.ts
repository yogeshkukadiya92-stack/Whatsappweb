// Persistent Auth Storage helper
// Stores credentials in localStorage (for persistent login across browser tabs and sessions)
// while keeping sessionStorage in sync for backward compatibility.

export const AUTH_KEYS = {
  API_KEY: 'openwa_api_key',
  REFRESH_TOKEN: 'openwa_supabase_refresh_token',
  EXPIRES_AT: 'openwa_token_expires_at',
} as const;

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignore quota or security exceptions (e.g. private browsing storage limits)
  }
}

function safeRemove(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore
  }
}

/** Retrieve the current API key or access token, checking localStorage first then sessionStorage. */
export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return safeGet(window.localStorage, AUTH_KEYS.API_KEY) || safeGet(window.sessionStorage, AUTH_KEYS.API_KEY);
}

/** Retrieve the Supabase refresh token, checking localStorage first then sessionStorage. */
export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    safeGet(window.localStorage, AUTH_KEYS.REFRESH_TOKEN) ||
    safeGet(window.sessionStorage, AUTH_KEYS.REFRESH_TOKEN)
  );
}

/** Retrieve the token expiry timestamp (epoch ms), if available. */
export function getStoredTokenExpiresAt(): number | null {
  if (typeof window === 'undefined') return null;
  const raw =
    safeGet(window.localStorage, AUTH_KEYS.EXPIRES_AT) ||
    safeGet(window.sessionStorage, AUTH_KEYS.EXPIRES_AT);
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

/** Check if the current token will expire within the given threshold (default: 5 minutes). */
export function isTokenExpiringSoon(thresholdMs = 5 * 60 * 1000): boolean {
  const expiresAt = getStoredTokenExpiresAt();
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - thresholdMs;
}

/**
 * Save auth tokens and expiry to persistent storage (both localStorage and sessionStorage).
 */
export function setStoredAuth(
  apiKey: string,
  refreshToken?: string | null,
  expiresInSeconds?: number | null,
): void {
  if (typeof window === 'undefined') return;

  // Persist to localStorage for cross-session/reopen retention
  safeSet(window.localStorage, AUTH_KEYS.API_KEY, apiKey);
  // Also keep in sessionStorage for backwards-compat and test assertions
  safeSet(window.sessionStorage, AUTH_KEYS.API_KEY, apiKey);

  if (refreshToken) {
    safeSet(window.localStorage, AUTH_KEYS.REFRESH_TOKEN, refreshToken);
    safeSet(window.sessionStorage, AUTH_KEYS.REFRESH_TOKEN, refreshToken);
  } else if (refreshToken === null) {
    safeRemove(window.localStorage, AUTH_KEYS.REFRESH_TOKEN);
    safeRemove(window.sessionStorage, AUTH_KEYS.REFRESH_TOKEN);
  }

  if (expiresInSeconds && expiresInSeconds > 0) {
    const expiresAt = String(Date.now() + expiresInSeconds * 1000);
    safeSet(window.localStorage, AUTH_KEYS.EXPIRES_AT, expiresAt);
    safeSet(window.sessionStorage, AUTH_KEYS.EXPIRES_AT, expiresAt);
  } else if (expiresInSeconds === null) {
    safeRemove(window.localStorage, AUTH_KEYS.EXPIRES_AT);
    safeRemove(window.sessionStorage, AUTH_KEYS.EXPIRES_AT);
  }

  try {
    window.dispatchEvent(new CustomEvent('openwa_auth_changed', { detail: { apiKey } }));
  } catch {
    // Ignore in environments without CustomEvent
  }
}

/**
 * Wipe all stored credentials from both localStorage and sessionStorage on explicit logout.
 */
export function clearStoredAuth(): void {
  if (typeof window === 'undefined') return;

  safeRemove(window.localStorage, AUTH_KEYS.API_KEY);
  safeRemove(window.sessionStorage, AUTH_KEYS.API_KEY);
  safeRemove(window.localStorage, AUTH_KEYS.REFRESH_TOKEN);
  safeRemove(window.sessionStorage, AUTH_KEYS.REFRESH_TOKEN);
  safeRemove(window.localStorage, AUTH_KEYS.EXPIRES_AT);
  safeRemove(window.sessionStorage, AUTH_KEYS.EXPIRES_AT);

  try {
    window.dispatchEvent(new CustomEvent('openwa_auth_changed', { detail: { apiKey: null } }));
  } catch {
    // Ignore
  }
}

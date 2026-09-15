export interface StudioOAuthCallback {
  id: string;
  state: string;
  iss: string;
  code?: string;
  error?: string;
}
export function parseStudioOAuthCallback(url: URL): StudioOAuthCallback | undefined {
  if (url.pathname !== '/automation-studio') return;
  const p = url.searchParams;
  const state = p.get('state') || '';
  const id = state.split('.')[0];
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i.test(state) ||
    p.get('iss') !== 'https://dashboard.coachforlife.in' ||
    ['state', 'iss', 'code', 'error'].some(key => p.getAll(key).length > 1)
  )
    return;
  const code = p.get('code') || undefined;
  const error = p.get('error') || undefined;
  if (code ? !/^[A-Za-z0-9_-]{32,2048}$/.test(code) || !!error : error !== 'access_denied') return;
  return { id, state, iss: p.get('iss')!, code, error };
}
// One-use authorization codes live only in memory until an authenticated POST. Never localStorage.
let callback: StudioOAuthCallback | undefined;
let callbackSession: string | undefined;
const contextKey = 'waply_studio_oauth_context';
export function rememberStudioOAuth(sessionId: string, authorizationUrl: string) {
  const state = new URL(authorizationUrl).searchParams.get('state');
  if (!state) throw new Error('Missing OAuth state.');
  sessionStorage.setItem(contextKey, JSON.stringify({ sessionId, state, expires: Date.now() + 300000 }));
}
if (typeof window !== 'undefined' && window.location.pathname === '/automation-studio') {
  const url = new URL(window.location.href);
  callback = parseStudioOAuthCallback(url);
  if (callback) {
    try {
      const context = JSON.parse(sessionStorage.getItem(contextKey) || 'null');
      if (
        !context ||
        context.state !== callback.state ||
        context.expires <= Date.now() ||
        typeof context.sessionId !== 'string' ||
        context.sessionId.length > 200
      )
        callback = undefined;
      else callbackSession = context.sessionId;
    } catch {
      callback = undefined;
    }
    sessionStorage.removeItem(contextKey);
  }
  if (['code', 'state', 'iss', 'error'].some(key => url.searchParams.has(key))) {
    for (const key of ['code', 'state', 'iss', 'error', 'error_description']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}
export function takeStudioOAuthCallback() {
  const result = callback;
  callback = undefined;
  return result;
}
export function hasStudioOAuthCallback() {
  return !!callback;
}
export function studioOAuthCallbackSession() {
  return callbackSession;
}

import '../test-helpers/register-hooks.ts';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { installJsdomGlobals as installJsdomGlobalsFn } from '../test-helpers/jsdom.ts';
import {
  AUTH_KEYS,
  getStoredApiKey,
  getStoredRefreshToken,
  getStoredTokenExpiresAt,
  isTokenExpiringSoon,
  setStoredAuth,
  clearStoredAuth,
} from './authStorage.ts';

let installJsdomGlobals: typeof installJsdomGlobalsFn;

before(async () => {
  ({ installJsdomGlobals } = await import('../test-helpers/jsdom.ts'));
  await installJsdomGlobals();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('getStoredApiKey returns null when no key is set', () => {
  assert.equal(getStoredApiKey(), null);
});

test('setStoredAuth persists API key and refresh token to both localStorage and sessionStorage', () => {
  setStoredAuth('test-token-123', 'test-refresh-456', 3600);

  assert.equal(localStorage.getItem(AUTH_KEYS.API_KEY), 'test-token-123');
  assert.equal(sessionStorage.getItem(AUTH_KEYS.API_KEY), 'test-token-123');
  assert.equal(localStorage.getItem(AUTH_KEYS.REFRESH_TOKEN), 'test-refresh-456');
  assert.equal(sessionStorage.getItem(AUTH_KEYS.REFRESH_TOKEN), 'test-refresh-456');

  assert.equal(getStoredApiKey(), 'test-token-123');
  assert.equal(getStoredRefreshToken(), 'test-refresh-456');

  const expiresAt = getStoredTokenExpiresAt();
  assert.ok(expiresAt !== null && expiresAt > Date.now());
});

test('getStoredApiKey falls back to sessionStorage if localStorage is empty', () => {
  sessionStorage.setItem(AUTH_KEYS.API_KEY, 'legacy-session-key');
  assert.equal(getStoredApiKey(), 'legacy-session-key');
});

test('clearStoredAuth removes tokens and expiry from both localStorage and sessionStorage', () => {
  setStoredAuth('token', 'refresh', 3600);
  clearStoredAuth();

  assert.equal(getStoredApiKey(), null);
  assert.equal(getStoredRefreshToken(), null);
  assert.equal(getStoredTokenExpiresAt(), null);
  assert.equal(localStorage.getItem(AUTH_KEYS.API_KEY), null);
  assert.equal(sessionStorage.getItem(AUTH_KEYS.API_KEY), null);
});

test('isTokenExpiringSoon identifies tokens close to expiry', () => {
  // Token expiring in 2 minutes (120s)
  setStoredAuth('token', 'refresh', 120);
  assert.equal(isTokenExpiringSoon(5 * 60 * 1000), true);

  // Token expiring in 60 minutes (3600s)
  setStoredAuth('token', 'refresh', 3600);
  assert.equal(isTokenExpiringSoon(5 * 60 * 1000), false);
});

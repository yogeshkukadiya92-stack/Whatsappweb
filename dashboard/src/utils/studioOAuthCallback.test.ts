import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStudioOAuthCallback } from './studioOAuthCallback.ts';
const root = 'https://wa.yogeshaihub.in/automation-studio';
const state = '12345678-1234-1234-1234-123456789abc.' + 's'.repeat(43);
const valid = () =>
  new URL(root + '?' + new URLSearchParams({ state, code: 'c'.repeat(43), iss: 'https://dashboard.coachforlife.in' }));
test('accepts only bounded CFL authorization-code callbacks', () => {
  assert.equal(parseStudioOAuthCallback(valid())?.id, state.split('.')[0]);
});
test('rejects duplicate parameters, mixed outcomes, other issuer and invalid state', () => {
  for (const key of ['state', 'code', 'iss']) {
    const u = valid();
    u.searchParams.append(key, 'other');
    assert.equal(parseStudioOAuthCallback(u), undefined);
  }
  for (const [key, value] of [
    ['iss', 'https://evil.example'],
    ['state', 'other'],
    ['code', 'short'],
    ['error', 'access_denied'],
  ]) {
    const u = valid();
    u.searchParams.set(key, value);
    assert.equal(parseStudioOAuthCallback(u), undefined);
  }
});
test('accepts validated cancellation but no arbitrary error or different callback route', () => {
  const u = valid();
  u.searchParams.delete('code');
  u.searchParams.set('error', 'access_denied');
  assert.equal(parseStudioOAuthCallback(u)?.error, 'access_denied');
  u.pathname = '/other';
  assert.equal(parseStudioOAuthCallback(u), undefined);
});

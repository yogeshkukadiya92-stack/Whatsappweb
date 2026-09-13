import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLeadFlowSessionId } from './leadFlowSession.ts';

test('editing from All Sessions targets the session that owns the flow', () => {
  assert.equal(resolveLeadFlowSessionId('all', 'session-b', 'session-a'), 'session-b');
});

test('creating from All Sessions uses the first available session', () => {
  assert.equal(resolveLeadFlowSessionId('all', null, 'session-a'), 'session-a');
});

test('a selected session remains the target for a new flow', () => {
  assert.equal(resolveLeadFlowSessionId('session-b', null, 'session-a'), 'session-b');
});

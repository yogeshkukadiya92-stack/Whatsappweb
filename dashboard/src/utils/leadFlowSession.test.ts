import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLeadFlowScope, resolveLeadFlowSessionId, resolveSessionSelection } from './leadFlowSession.ts';

test('editing from All Sessions targets the session that owns the flow', () => {
  assert.equal(resolveLeadFlowSessionId('all', 'session-b', 'session-a'), 'session-b');
});

test('creating from All Sessions requires selecting an explicit account', () => {
  assert.throws(() => resolveLeadFlowSessionId('all', null, 'session-a'), /Select a specific WhatsApp account/);
});

test('a selected session remains the target for a new flow', () => {
  assert.equal(resolveLeadFlowSessionId('session-b', null, 'session-a'), 'session-b');
});

test('All Sessions reads only accessible sessions, never the synthetic all session', async () => {
  const requested: string[] = [];
  const rows = await loadLeadFlowScope('all', ['session-a', 'session-b'], async id => {
    requested.push(id);
    if (id === 'all') throw new Error('Unauthorized session');
    return [{ sessionId: id }];
  });
  assert.deepEqual(requested, ['session-a', 'session-b']);
  assert.deepEqual(rows, [{ sessionId: 'session-a' }, { sessionId: 'session-b' }]);
});

test('no accessible sessions makes no request', async () => {
  assert.deepEqual(
    await loadLeadFlowScope('all', [], async () => {
      assert.fail('must not request global data');
    }),
    [],
  );
});

test('a concrete session loads only its own rows', async () => {
  assert.deepEqual(await loadLeadFlowScope('session-b', ['session-a', 'session-b'], async id => [id]), ['session-b']);
});

test('only admin can keep All Sessions selected', () => {
  assert.equal(resolveSessionSelection('admin', 'all', ['a', 'b']), 'all');
  for (const role of ['operator', 'viewer', null, undefined]) {
    assert.equal(resolveSessionSelection(role, 'all', ['a', 'b']), 'a');
    assert.equal(resolveSessionSelection(role, 'foreign', ['a', 'b']), 'a');
    assert.equal(resolveSessionSelection(role, 'b', ['a', 'b']), 'b');
    assert.equal(resolveSessionSelection(role, 'all', []), '');
  }
});

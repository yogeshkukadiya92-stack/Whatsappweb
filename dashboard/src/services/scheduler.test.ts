import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup(initial: any[] = [], overrides: Record<string, any> = {}) {
  const storage = new Map<string, string>([['openwa_scheduled_messages', JSON.stringify(initial)]]);
  const listeners = new Map<string, Function>();
  const intervals: Function[] = [];
  let sends = 0;
  let lists = 0;
  const imported: any[] = [];
  const api = {
    listAll: async () => { lists++; return imported; },
    list: async () => { lists++; return imported; },
    create: async (sessionId: string, item: any) => {
      const row = { ...item, sessionId, id: 'server-id', status: 'pending' };
      imported.push(row);
      return row;
    },
    sendNow: async () => { sends++; return { success: true }; },
    ...overrides,
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: () => ({ scheduledMessageApi: api }),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    window: {
      dispatchEvent: (event: any) => listeners.get(event.type)?.(),
      addEventListener: (event: string, callback: Function) => listeners.set(event, callback),
      removeEventListener: (event: string) => listeners.delete(event),
    },
    CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
    setInterval: (callback: Function) => { intervals.push(callback); return 1; },
    clearInterval: () => {},
    console,
  });
  return { scheduler: exports, storage, intervals, imported, sends: () => sends, lists: () => lists };
}

const legacy = { id: 'sched_123_abc', sessionId: 'session-1', status: 'pending', recipient: '12345678', recipientType: 'personal', messageType: 'text', details: { content: 'Scheduled' }, scheduledAt: '2020-01-01T00:00:00.000Z' };

test('queue refresh imports old browser jobs but never sends due messages from the browser', async () => {
  const fixture = setup([legacy]);
  const stop = fixture.scheduler.startGlobalMessageScheduler();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.imported.length, 1);
  assert.equal(fixture.imported[0].clientId, legacy.id);
  assert.equal(fixture.sends(), 0);
  assert.equal(fixture.lists(), 1, 'cache notifications must not trigger a recursive refresh');
  assert.ok(fixture.storage.has('openwa_scheduled_messages_legacy_backup'));
  await fixture.intervals[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.imported.length, 1);
  assert.equal(fixture.sends(), 0);
  stop();
});

test('failed imports remain visible and are preserved for retry', async () => {
  const fixture = setup([legacy], { create: async () => { throw new Error('offline'); } });
  const rows = await fixture.scheduler.syncScheduledItemsWithBackend();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, legacy.id);
  assert.match(rows[0].error, /Not yet saved on server/);
  assert.equal(fixture.sends(), 0);
});

test('an ambiguous manual-send failure never falls back to a second direct send', async () => {
  let attempts = 0;
  const fixture = setup([], { sendNow: async () => { attempts++; throw new Error('response lost'); } });
  const result = await fixture.scheduler.executeScheduledMessage({ ...legacy, id: 'server-id' });
  assert.equal(result.success, false);
  assert.equal(attempts, 1);
});

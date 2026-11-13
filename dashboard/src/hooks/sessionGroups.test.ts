import '../test-helpers/register-hooks.ts';
import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
let rtl: typeof import('@testing-library/react');
let api: typeof import('../services/api.ts');
let hooks: typeof import('./queries.ts');
let client: QueryClient;
before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  rtl = await import('@testing-library/react');
  api = await import('../services/api.ts');
  hooks = await import('./queries.ts');
});
afterEach(() => { rtl.cleanup(); client.clear(); });
function wrapper({ children }: {children: ReactNode}) {
  return createElement(QueryClientProvider, {client}, children);
}
test('group failure settles without retrying and a manual retry can recover', async () => {
  client = new QueryClient({defaultOptions:{queries:{retry: 1, retryDelay: 0}}});
  let calls = 0;
  api.sessionApi.getGroups = async () => { calls++; throw new Error('Session is not started'); };
  const hook = rtl.renderHook(() => hooks.useSessionGroupsQuery('yogesh', true), {wrapper});
  await rtl.waitFor(() => assert.equal(hook.result.current.isError, true));
  assert.equal(calls, 1);
  assert.equal(hook.result.current.isLoading, false);
  api.sessionApi.getGroups = async () => [{id:'group@g.us', name:'Recovered group'}];
  await rtl.act(async () => { await hook.result.current.refetch({throwOnError:true}); });
  await rtl.waitFor(() => assert.equal(hook.result.current.data?.[0].name, 'Recovered group'));
});
test('a stalled request has a deadline and is cancelled when the account changes', async t => {
  client = new QueryClient();
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { deadlines.push(ms); return new AbortController().signal; });
  let firstSignal: AbortSignal | undefined;
  api.sessionApi.getGroups = (id, signal) => {
    if (id === 'karma') return Promise.resolve([{id:'karma@g.us',name:'Karma group'}]);
    firstSignal = signal;
    return new Promise((_,reject) => signal?.addEventListener('abort', () => reject(signal.reason), {once:true}));
  };
  const hook = rtl.renderHook(({id}) => hooks.useSessionGroupsQuery(id,true), {wrapper,initialProps:{id:'yogesh'}});
  await rtl.waitFor(() => assert.ok(firstSignal));
  assert.equal(deadlines[0], 30000);
  hook.rerender({id:'karma'});
  await rtl.waitFor(() => assert.equal(hook.result.current.data?.[0].name, 'Karma group'));
  assert.equal(firstSignal?.aborted, true);
});
test('an unanswered group request exits loading when its deadline expires', async t => {
  client = new QueryClient();
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', () => timeout(10));
  api.sessionApi.getGroups = (_id, signal) => new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), {once:true});
  });
  const hook = rtl.renderHook(() => hooks.useSessionGroupsQuery('yogesh',true), {wrapper});
  await rtl.waitFor(() => assert.equal(hook.result.current.isError, true));
  assert.equal(hook.result.current.isLoading, false);
  assert.equal(hook.result.current.error?.name, 'TimeoutError');
});

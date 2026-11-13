import '../test-helpers/register-hooks.ts';
import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

let rtl: typeof import('@testing-library/react');
let api: typeof import('../services/api.ts');
let Dashboard: typeof import('./Dashboard.tsx')['Dashboard'];
let RoleContext: typeof import('../hooks/useRole.tsx')['RoleContext'];
let overviewCalls = 0;
let client: QueryClient;
let scheduleCalls = 0;
let chartCalls = 0;
let intersect: IntersectionObserverCallback;
let disconnects = 0;

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {}
    disconnect() { disconnects++; }
  } });
  rtl = await import('@testing-library/react');
  api = await import('../services/api.ts');
  ({ Dashboard } = await import('./Dashboard.tsx'));
  ({ RoleContext } = await import('../hooks/useRole.tsx'));
  api.sessionApi.list = async () => [];
  api.sessionApi.getStats = async () => ({ total: 0, active: 0, ready: 0 }) as Awaited<ReturnType<typeof api.sessionApi.getStats>>;
  api.webhookApi.listAll = async () => [];
  api.statsApi.getOverview = async () => { overviewCalls++; return { messages: { today: { sent: 0, received: 0 }, sent: 0, received: 0 } } as Awaited<ReturnType<typeof api.statsApi.getOverview>>; };
  api.scheduledMessageApi.getSummary = async () => { scheduleCalls++; return { pendingCount: 0, upcoming: [] }; };
  api.statsApi.getMessages = async () => { chartCalls++; throw Object.assign(new Error('Forbidden'), { status: 403 }); };
});

afterEach(() => { rtl.cleanup(); client.clear(); scheduleCalls = 0; chartCalls = 0; overviewCalls = 0;
  api.scheduledMessageApi.getSummary = async () => { scheduleCalls++; return { pendingCount: 0, upcoming: [] }; };
});

function renderDashboard(role: 'admin' | 'operator' | 'viewer' = 'admin', isSessionScoped = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtl.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, {}, createElement(RoleContext.Provider, { value: { role, isAdmin: role === 'admin', isOperator: role === 'operator', isViewer: role === 'viewer', canWrite: role !== 'viewer', isSessionScoped, user: null, setRole() {}, setUser() {} } }, createElement(Dashboard)))));
}

test('ignores unrelated storage and focus events; refreshes changed schedules', async () => {
  renderDashboard();
  await rtl.waitFor(() => assert.equal(scheduleCalls, 1));
  rtl.fireEvent(window, new window.StorageEvent('storage', { key: 'unrelated-setting' }));
  rtl.fireEvent.focus(window);
  assert.equal(scheduleCalls, 1);
  rtl.fireEvent(window, new window.Event('openwa_scheduled_updated'));
  await rtl.waitFor(() => assert.equal(scheduleCalls, 2));
  rtl.fireEvent(window, new window.StorageEvent('storage', { key: 'openwa_scheduled_messages' }));
  await rtl.waitFor(() => assert.equal(scheduleCalls, 3));
});

test('does not request chart data until analytics approaches the viewport', async () => {
  const view = renderDashboard();
  await rtl.waitFor(() => assert.equal(scheduleCalls, 1));
  assert.equal(chartCalls, 0);
  assert.ok(intersect);
  await rtl.act(async () => {
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await rtl.waitFor(() => assert.equal(chartCalls, 1));
  assert.ok(disconnects > 0);
  view.unmount();
});


test('shows the exact pending count even when the summary contains only three previews', async () => {
  api.scheduledMessageApi.getSummary = async () => ({ pendingCount: 100, upcoming: [1, 2, 3].map(id => ({
    id: String(id), recipient: '123@c.us', messageType: 'text', scheduledAt: '2030-01-01T10:00:00Z', previewText: `Queue preview ${id}`,
  })) });
  renderDashboard();
  await rtl.screen.findByText('100 Pending');
  assert.equal(rtl.screen.getAllByText(/Queue preview/).length, 3);
  assert.ok(rtl.screen.getByText('100 scheduled · 0 workflows'));
});

for (const [role, scoped] of [['operator', false], ['viewer', false], ['admin', true]] as const) {
  test(`${role} scoped=${scoped} skips unavailable global analytics requests`, async () => {
    renderDashboard(role, scoped);
    await rtl.waitFor(() => assert.equal(scheduleCalls, 1));
    await rtl.act(async () => {
      intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    assert.equal(overviewCalls, 0);
    assert.equal(chartCalls, 0);
  });
}

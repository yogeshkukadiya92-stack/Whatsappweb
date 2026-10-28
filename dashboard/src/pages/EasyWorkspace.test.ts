import '../test-helpers/register-hooks.ts';
import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

let rtl: typeof import('@testing-library/react');
let api: typeof import('../services/api.ts');
let Home: typeof import('./EasyHome.tsx')['EasyHome'];
let Automations: typeof import('./Automations.tsx')['Automations'];
let RoleContext: typeof import('../hooks/useRole.tsx')['RoleContext'];
const clients: QueryClient[] = [];
const flow = { id: 'welcome', sessionId: 'karma', name: 'Welcome reply', enabled: true, updatedAt: '', definition: { keywords: ['hi'], audience: 'direct' as const, cooldownSeconds: 60, steps: [] } };

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  rtl = await import('@testing-library/react');
  api = await import('../services/api.ts');
  ({ EasyHome: Home } = await import('./EasyHome.tsx'));
  ({ Automations } = await import('./Automations.tsx'));
  ({ RoleContext } = await import('../hooks/useRole.tsx'));
  api.sessionApi.list = async () => [{ id: 'karma', name: 'Karma', status: 'ready' }, { id: 'yogesh', name: 'Yogesh', status: 'ready' }] as Awaited<ReturnType<typeof api.sessionApi.list>>;
  api.scheduledMessageApi.listAll = async () => [];
  api.studioApi.list = async session => session === 'karma' ? [{ ...flow }] : [];
});
afterEach(() => { rtl.cleanup(); clients.forEach(client => client.clear()); clients.length = 0; });

function render(Page: typeof Home, canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  rtl.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, {}, createElement(RoleContext.Provider, { value: { role: canWrite ? 'operator' : 'viewer', user: null, setRole() {}, setUser() {}, isAdmin: false, isOperator: canWrite, isViewer: !canWrite, canWrite, isSessionScoped: false } }, createElement(Page)))));
}

test('Home carries selected account into schedule and automation shortcuts', async () => {
  render(Home);
  const select = await rtl.screen.findByLabelText('WhatsApp account');
  await rtl.waitFor(() => assert.equal((select as HTMLSelectElement).value, 'karma'));
  rtl.fireEvent.change(select, { target: { value: 'yogesh' } });
  assert.match(rtl.screen.getAllByRole('link', { name: /Schedule a message/ })[0].getAttribute('href')!, /mode=schedule&session=yogesh/);
  assert.equal(rtl.screen.getByRole('link', { name: /Manage auto-replies/ }).getAttribute('href'), '/automations?session=yogesh');
});

test('failed pause retains active state and surfaces an error', async () => {
  api.studioApi.save = async () => { throw new Error('Connection unavailable'); };
  render(Automations);
  rtl.fireEvent.click(await rtl.screen.findByRole('button', { name: 'Pause' }));
  assert.match((await rtl.screen.findByRole('alert')).textContent!, /Could not save/);
  assert.ok(rtl.screen.getByText('Active'));
});

test('viewer cannot activate or pause automations', async () => {
  render(Automations, false);
  const pause = await rtl.screen.findByRole('button', { name: 'Pause' });
  assert.equal((pause as HTMLButtonElement).disabled, true);
  assert.equal((rtl.screen.getByRole('button', { name: 'New auto-reply' }) as HTMLButtonElement).disabled, true);
});

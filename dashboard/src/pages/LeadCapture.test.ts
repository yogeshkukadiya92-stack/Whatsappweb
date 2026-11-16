import '../test-helpers/register-hooks.ts';
import { before, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

let rtl: typeof import('@testing-library/react');
let api: typeof import('../services/api.ts');
let LeadCapture: typeof import('./LeadCapture.tsx')['LeadCapture'];
let RoleContext: typeof import('../hooks/useRole.tsx')['RoleContext'];
let ToastProvider: typeof import('../components/Toast.tsx')['ToastProvider'];
let useToast: typeof import('../hooks/useToast.ts')['useToast'];
let client: QueryClient;
let flowCalls = 0;

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  rtl = await import('@testing-library/react');
  api = await import('../services/api.ts');
  ({ LeadCapture } = await import('./LeadCapture.tsx'));
  ({ RoleContext } = await import('../hooks/useRole.tsx'));
  ({ ToastProvider } = await import('../components/Toast.tsx'));
  ({ useToast } = await import('../hooks/useToast.ts'));
  api.sessionApi.list = async () => [{ id: 'mine', name: 'My WhatsApp', status: 'ready' }] as Awaited<ReturnType<typeof api.sessionApi.list>>;
});
afterEach(() => { rtl.cleanup(); client.clear(); flowCalls = 0; });

function ToastButton() {
  const toast = useToast();
  return createElement('button', { onClick: () => toast.info('Unrelated notification') }, 'Notify');
}
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  rtl.render(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, null,
      createElement(RoleContext.Provider, { value: { role: 'operator', loading: false } },
        createElement(ToastProvider, null, createElement(ToastButton), createElement(LeadCapture))))));
}

const flow = { id: 'flow-1', sessionId: 'mine', name: 'Saved consultation', enabled: true, triggers: ['hello'],
  steps: [{ key: 'name', question: 'Your name?' }], completionMessage: 'Thank you {{name}}' } as Awaited<ReturnType<typeof api.leadFlowsApi.listFlows>>[number];

test('failed loading settles, survives toast updates, and retries the saved flow only on request', async () => {
  api.leadFlowsApi.listFlows = async () => { flowCalls++; throw new Error('Supabase authentication is unavailable'); };
  renderPage();
  const session = await rtl.screen.findByLabelText('Session:');
  await rtl.screen.findByRole('option', { name: 'My WhatsApp (ready)' });
  rtl.fireEvent.change(session, { target: { value: 'mine' } });
  const retry = await rtl.screen.findByRole('button', { name: 'Retry workflows' });
  assert.equal(flowCalls, 1);
  assert.equal(rtl.screen.queryByText('Loading flows...'), null);
  assert.equal(rtl.screen.queryByText('No Workflow Funnels created yet'), null);
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Notify' }));
  await rtl.screen.findByText('Unrelated notification');
  assert.equal(flowCalls, 1, 'toast context changes must not restart the failed request');
  api.leadFlowsApi.listFlows = async () => { flowCalls++; return [flow]; };
  rtl.fireEvent.click(retry);
  await rtl.screen.findByText('Saved consultation');
  assert.equal(flowCalls, 2);
  assert.equal(rtl.screen.queryByRole('alert'), null);
});

test('failed captured-lead loading shows Retry instead of claiming no leads exist', async () => {
  api.leadFlowsApi.listFlows = async () => [flow];
  let leadCalls = 0;
  api.leadFlowsApi.listLeads = async () => { leadCalls++; throw new Error('Authentication temporarily unavailable'); };
  renderPage();
  await rtl.screen.findByRole('option', { name: 'My WhatsApp (ready)' });
  rtl.fireEvent.change(rtl.screen.getByLabelText('Session:'), { target: { value: 'mine' } });
  await rtl.screen.findByText('Saved consultation');
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Captured Leads (0)' }));
  const retry = await rtl.screen.findByRole('button', { name: 'Retry leads' });
  assert.equal(leadCalls, 1);
  assert.equal(rtl.screen.queryByText('No leads captured yet'), null);
  api.leadFlowsApi.listLeads = async () => { leadCalls++; return []; };
  rtl.fireEvent.click(retry);
  await rtl.screen.findByText('No leads captured yet');
  assert.equal(leadCalls, 2);
});

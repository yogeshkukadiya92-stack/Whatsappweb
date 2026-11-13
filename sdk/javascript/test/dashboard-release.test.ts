import { expect, it } from 'vitest';
import { OpenWAClient } from '../src';
import { MockTransport } from './helpers';

it('downloads UTF-8 CSV without parsing JSON and encodes identifiers', async () => {
  const csv = 'name,phone\nયોગેશ,123\n';
  const transport = new MockTransport().passthrough({ text: csv, contentType: 'text/csv' });
  const client = new OpenWAClient({ baseUrl: 'http://localhost', apiKey: 'key', fetch: transport.asFetch() });
  expect(await client.groups.exportParticipantsCsv('a/b', 'g/x')).toBe(csv);
  expect(transport.lastCall?.url).toBe('http://localhost/api/sessions/a%2Fb/groups/g%2Fx/participants/export/csv');
  expect(transport.lastCall?.method).toBe('GET');
  expect(await client.groups.exportAllParticipantsCsv('a/b')).toBe(csv);
  expect(transport.lastCall?.url).toBe('http://localhost/api/sessions/a%2Fb/groups/export/all-participants/csv');
});

it('posts the emergency stop command and preserves cancellation counts', async () => {
  const result = { success: true, sessionId: 'a/b', cancelledJobs: 3, cancelledBatches: 2, cancelledMessages: 4, message: 'Stopped' };
  const transport = new MockTransport().passthrough({ body: result });
  const client = new OpenWAClient({ baseUrl: 'http://localhost', apiKey: 'key', fetch: transport.asFetch() });
  expect(await client.sessions.stopPendingReplies('a/b')).toEqual(result);
  expect(transport.lastCall?.url).toBe('http://localhost/api/sessions/a%2Fb/stop-pending-replies');
  expect(transport.lastCall?.method).toBe('POST');
});

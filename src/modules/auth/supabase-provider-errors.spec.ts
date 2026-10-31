import { ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';

describe('Supabase provider authentication boundaries', () => {
  const savedEnv = { ...process.env };
  const originalFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  const service = new SupabaseAuthService();
  const identity = { id: 'verified-user', email: 'customer@example.test', email_confirmed_at: '2026-01-01' };
  const session = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: identity };
  beforeEach(() => {
    process.env.SUPABASE_AUTH_URL = 'https://auth.example.test/';
    process.env.SUPABASE_ANON_KEY = 'public-fixture';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-fixture';
    fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    global.fetch = originalFetch;
  });
  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  it('sends passwords only to the configured auth endpoint without following redirects', async () => {
    reply(session);
    await expect(service.signIn('customer@example.test', 'password')).resolves.toEqual(session);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.example.test/auth/v1/token?grant_type=password');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { apikey: 'public-fixture' } });
    expect(JSON.parse(options!.body as string)).toEqual({ email: 'customer@example.test', password: 'password' });
  });
  it.each([
    {},
    { ...session, access_token: '' },
    { ...session, refresh_token: '' },
    { ...session, user: {} },
    { ...session, user: { id: 'unverified' } },
  ])('refuses malformed or unverified sign-in responses %#', async body => {
    reply(body);
    await expect(service.signIn('email', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects invalid passwords and provider outages with separate public errors', async () => {
    reply({}, 401);
    await expect(service.signIn('email', 'password')).rejects.toThrow('Invalid email or password');
    fetchMock.mockRejectedValueOnce(new Error('private network detail'));
    await expect(service.signIn('email', 'password')).rejects.toThrow('Supabase authentication is unavailable');
  });
  it.each(['file:///tmp/auth', 'https://user:password@auth.example.test', 'not a url'])(
    'refuses an invalid configured destination %s',
    async url => {
      process.env.SUPABASE_AUTH_URL = url;
      await expect(service.getUser('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('fails closed without configuration', async () => {
    delete process.env.SUPABASE_AUTH_URL;
    expect(service.enabled).toBe(false);
    await expect(service.getUser('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('uses the admin credential only on provisioning and percent-encodes rollback identities', async () => {
    reply(identity);
    await expect(service.createUser('email', 'password', 'Name')).resolves.toEqual(identity);
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.example.test/auth/v1/admin/users');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { apikey: 'private-fixture', Authorization: 'Bearer private-fixture' },
      body: JSON.stringify({
        email: 'email',
        password: 'password',
        user_metadata: { name: 'Name' },
        email_confirm: true,
      }),
    });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await service.deleteCreatedUser('identity/with?separator');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://auth.example.test/auth/v1/admin/users/identity%2Fwith%3Fseparator',
    );
  });
  it('refuses provisioning without a server admin key before calling the provider', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(service.createUser('email', 'password', 'Name')).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([409, 422])('preserves provisioning conflicts (%i)', async status => {
    reply({}, status);
    await expect(service.createUser('email', 'password', 'Name')).rejects.toBeInstanceOf(ConflictException);
  });
  it('detects rejected and incomplete admin responses and rollback failure', async () => {
    reply({}, 503);
    await expect(service.createUser('email', 'password', 'Name')).rejects.toBeInstanceOf(ServiceUnavailableException);
    reply({});
    await expect(service.createUser('email', 'password', 'Name')).rejects.toThrow('user ID');
    reply({}, 500);
    await expect(service.deleteCreatedUser('id')).rejects.toThrow('roll back');
  });
  it('submits signup metadata and reports sanitized provider errors', async () => {
    reply({});
    await service.signUp('email', 'password', 'Name');
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ email: 'email', password: 'password', data: { name: 'Name' } }),
    );
    for (const body of [{ msg: 'email unavailable' }, { message: 'signup refused' }, {}]) {
      reply(body, 400);
      await expect(service.signUp('email', 'password', 'Name')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 500 }));
    await expect(service.signUp('email', 'password', 'Name')).rejects.toThrow('Could not create Supabase account');
  });
  it('refreshes only a complete verified session', async () => {
    reply(session);
    await expect(service.refresh('previous-refresh')).resolves.toEqual(session);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ refresh_token: 'previous-refresh' }));
    reply({}, 401);
    await expect(service.refresh('token')).rejects.toThrow('expired');
    reply({});
    await expect(service.refresh('token')).rejects.toThrow('valid session');
    reply({ ...session, user: { id: 'unverified' } });
    await expect(service.refresh('token')).rejects.toThrow('not verified');
  });
  it('checks identity confirmation independently of token-shaped input', async () => {
    reply(identity);
    await expect(service.getUser('access')).resolves.toEqual(identity);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer access' });
    reply({}, 401);
    await expect(service.getUser('access')).rejects.toThrow('invalid');
    reply({ id: 'unverified' });
    await expect(service.getUser('access')).rejects.toThrow('not verified');
  });
});

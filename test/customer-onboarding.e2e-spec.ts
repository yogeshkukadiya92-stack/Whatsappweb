jest.mock('archiver', () => ({ TarArchive: jest.fn() }));
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service';
import { AppModule } from '../src/app.module';
import { applyGlobalValidation } from '../src/config/app-validation';
import { AuthService } from '../src/modules/auth/auth.service';
import { ApiKeyRole } from '../src/modules/auth/entities/api-key.entity';

it('registers a demo customer and applies admin feature changes to its existing login', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  applyGlobalValidation(app);
  await app.init();
  try {
    const http = request(app.getHttpServer());
    const auth = app.get(AuthService);
    const { rawKey } = await auth.createApiKey({ name: 'QA admin', role: ApiKeyRole.ADMIN });
    const email = 'demo@example.test';
    const password = randomBytes(20).toString('hex');
    const signup = await http.post('/api/auth/register').send({ name: 'Demo Customer', email, password }).expect(201);
    const id = signup.body.user.id;
    const login = await http.post('/api/auth/login').send({ email, password }).expect(200);
    const token = login.body.token;
    await http.get('/api/auth/users').set('X-API-Key', token).expect(403);
    const update = (features: string[]) =>
      http
        .patch('/api/auth/users/' + id + '/subscription')
        .set('X-API-Key', rawKey)
        .send({ features })
        .expect(200);
    await http.post('/api/billing/setup-call').set('X-API-Key', token).send({phone:'+919876543210'}).expect(201);
    await http.get('/api/billing/setup-calls').set('X-API-Key', token).expect(403);
    await http.get('/api/billing/setup-calls').set('X-API-Key', rawKey).expect(200).expect(r => expect(r.body).toEqual([expect.objectContaining({id, email, phone:'+919876543210'})]));
    await http.post('/api/billing/setup-calls/'+id+'/complete').set('X-API-Key', rawKey).expect(201);
    await http.get('/api/billing/setup-calls').set('X-API-Key', rawKey).expect(200, []);
    await update([]);
    await http.get('/api/scheduled-messages').set('X-API-Key', token).expect(403);
    await update(['messaging']);
    await http.get('/api/scheduled-messages').set('X-API-Key', token).expect(200, []);
    await http
      .get('/api/auth/me')
      .set('X-API-Key', token)
      .expect(200)
      .expect(r => expect(r.body.user.features).toEqual(['messaging']));
    await http.get('/api/sessions').set('X-API-Key', token).expect(200, []);
  } finally {
    await app.close().catch(() => undefined);
  }
}, 30000);

it('provisions a confirmed Supabase demo identity once and preserves its admin settings on later logins', async () => {
  const previous = process.env.SUPABASE_SIGNUP_ENABLED;
  process.env.SUPABASE_SIGNUP_ENABLED = 'true';
  const email = 'verified-demo@example.test';
  const password = randomBytes(20).toString('hex');
  const identity = {
    id: '99af60bf-be0e-4dd1-b930-65f832892993',
    email,
    email_confirmed_at: 'confirmed',
    user_metadata: { name: 'Verified Demo' },
  };
  const provider = {
    enabled: true,
    signUp: jest.fn(),
    signIn: jest.fn().mockResolvedValue({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
      user: identity,
    }),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SupabaseAuthService)
    .useValue(provider)
    .compile();
  const app = module.createNestApplication();
  try {
    applyGlobalValidation(app);
    await app.init();
    const http = request(app.getHttpServer());
    await http.post('/api/auth/supabase/signup').send({ email, password, name: 'Verified Demo' }).expect(202);
    expect(provider.signUp).toHaveBeenCalledWith(email, password, 'Verified Demo');
    const login = () => http.post('/api/auth/supabase/login').send({ email, password }).expect(200);
    await login();
    const auth = app.get(AuthService);
    const key = await auth.findSupabaseKey(identity.id);
    expect(key.role).toBe(ApiKeyRole.OPERATOR);
    const user = await auth.findUserByApiKeyId(key.id);
    expect(user?.email).toBe(email);
    await auth.updateSubscription(user!.id, { features: ['leads'] });
    await login();
    expect((await auth.findSupabaseKey(identity.id)).id).toBe(key.id);
    expect((await auth.findUserByApiKeyId(key.id))?.features).toEqual(['leads']);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SIGNUP_ENABLED;
    else process.env.SUPABASE_SIGNUP_ENABLED = previous;
    await app.close().catch(() => undefined);
  }
}, 30000);

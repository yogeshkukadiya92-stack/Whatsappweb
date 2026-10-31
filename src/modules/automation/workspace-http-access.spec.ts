import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { AuthService } from '../auth/auth.service';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { AuditService } from '../audit/audit.service';
import { AiBotController } from './ai-bot.controller';
import { AiBotService } from './ai-bot.service';
import { LeadFlowController } from './lead-flow.controller';
import { LeadFlowService } from './lead-flow.service';
import { CloudMenuController, CloudMenuWebhookController } from './cloud-menu.controller';
import { CloudMenuService } from './cloud-menu.service';
import { StudioConnectionController } from './studio-connection.controller';
import { StudioConnectionService } from './studio-connection.service';
import { StudioWorkflowController, StudioHookController } from './studio-workflow.controller';
import { StudioWorkflowService } from './studio-workflow.service';
import { StudioPlannerService } from './studio-planner.service';
import { oauthHash } from './studio-oauth';

type Verb = 'get' | 'post' | 'put' | 'delete';
type Route = {
  verb: Verb;
  path: string;
  service: string;
  method: string;
  role?: ApiKeyRole;
  status?: number;
  args?: unknown[];
};
const routes: Route[] = [
  ...[
    ['get', 'ai-bot', 'getMaskedConfig'],
    ['put', 'ai-bot', 'updateConfig'],
    ['post', 'ai-bot/test', 'testPrompt'],
    ['post', 'ai-bot/extract-document', 'extractDocument'],
    ['get', 'ai-bot/agents', 'listAgents'],
    ['post', 'ai-bot/agents', 'createAgent'],
    ['put', 'ai-bot/agents/item', 'updateAgent'],
    ['delete', 'ai-bot/agents/item', 'deleteAgent'],
    ['get', 'ai-bot/query-captures', 'listQueryCaptures'],
    ['get', 'ai-bot/query-captures/export/csv', 'exportQueryCapturesCsv'],
  ].map(([verb, path, method]) => ({ verb: verb as Verb, path, method, service: 'ai' })),
  ...[
    ['get', 'lead-flows', 'findAllFlows'],
    ['post', 'lead-flows', 'createFlow'],
    ['get', 'lead-flows/item', 'findOneFlow'],
    ['put', 'lead-flows/item', 'updateFlow'],
    ['delete', 'lead-flows/item', 'removeFlow'],
    ['get', 'leads', 'findAllLeads'],
    ['delete', 'leads/item', 'removeLead'],
    ['get', 'leads-export/csv', 'exportLeadsCsv'],
  ].map(([verb, path, method]) => ({ verb: verb as Verb, path, method, service: 'leads' })),
  ...[
    ['get', 'cloud-resource-menu', 'settings'],
    ['put', 'cloud-resource-menu', 'save'],
    ['post', 'cloud-resource-menu/rotate-token', 'rotateToken'],
  ].map(([verb, path, method]) => ({ verb: verb as Verb, path, method, service: 'cloud', role: ApiKeyRole.ADMIN })),
  ...[
    ['get', 'studio-connections', 'list'],
    ['post', 'studio-connections', 'save'],
    ['put', 'studio-connections/item', 'save'],
    ['delete', 'studio-connections/item', 'remove'],
    ['post', 'studio-connections/item/tools', 'mcp'],
    ['post', 'studio-connections/item/oauth/start', 'startOAuth'],
    ['post', 'studio-connections/item/oauth/complete', 'completeOAuth'],
    ['post', 'studio-connections/item/oauth/disconnect', 'disconnectOAuth'],
  ].map(([verb, path, method]) => ({
    verb: verb as Verb,
    path,
    method,
    service: 'connections',
    role: verb === 'get' ? ApiKeyRole.OPERATOR : ApiKeyRole.ADMIN,
    status: verb === 'delete' ? 204 : undefined,
  })),
  ...[
    ['get', 'studio-workflows', 'list'],
    ['post', 'studio-workflows', 'save'],
    ['put', 'studio-workflows/item', 'save'],
    ['delete', 'studio-workflows/item', 'remove'],
    ['get', 'studio-workflows/executions', 'logs'],
    ['post', 'studio-workflows/executions/item/cancel', 'cancel'],
    ['post', 'studio-workflows/item/webhook-token', 'rotateWebhook'],
    ['post', 'studio-workflows/item/test', 'execute'],
    ['post', 'studio-workflows/generate', 'generate'],
  ].map(([verb, path, method]) => ({
    verb: verb as Verb,
    path,
    method,
    service: method === 'generate' ? 'planner' : 'workflows',
    role: ApiKeyRole.OPERATOR,
    status: verb === 'delete' || method === 'cancel' ? 204 : undefined,
  })),
];

describe('workspace HTTP session boundaries and provider callbacks', () => {
  let app: INestApplication<App>;
  const services: Record<string, Record<string, jest.Mock>> = {};
  const tokens = {
    ai: AiBotService,
    leads: LeadFlowService,
    cloud: CloudMenuService,
    connections: StudioConnectionService,
    workflows: StudioWorkflowService,
    planner: StudioPlannerService,
  };
  const payload = { message: 'fixture message', chatId: 'fixture@c.us', webhook: { event: 'test' } };
  beforeAll(async () => {
    for (const name of Object.keys(tokens)) {
      const methods = new Set(routes.filter(route => route.service === name).map(route => route.method));
      if (name === 'cloud') {
        methods.add('verify');
        methods.add('receive');
      }
      if (name === 'workflows') {
        methods.add('get');
        methods.add('receiveWebhook');
      }
      services[name] = Object.fromEntries(
        [...methods].map(method => [
          method,
          jest.fn().mockResolvedValue(method.includes('Csv') ? 'column\nvalue' : { result: method }),
        ]),
      );
    }
    services.cloud.verify.mockImplementation((_id: string, _mode: string, token: string, challenge: string) => {
      if (token !== 'provider-verify') throw new UnauthorizedException();
      return challenge;
    });
    services.cloud.receive.mockImplementation((_id: string, signature: string) => {
      if (signature !== 'provider-signature') throw new UnauthorizedException();
    });
    services.workflows.receiveWebhook.mockImplementation((_id: string, token: string) => {
      if (token !== 'workflow-secret') throw new UnauthorizedException();
      return { accepted: true };
    });
    const testing = await Test.createTestingModule({
      controllers: [
        AiBotController,
        LeadFlowController,
        CloudMenuController,
        CloudMenuWebhookController,
        StudioConnectionController,
        StudioWorkflowController,
        StudioHookController,
      ],
      providers: Object.entries(tokens).map(([name, token]) => ({ provide: token, useValue: services[name] })),
    }).compile();
    app = testing.createNestApplication<INestApplication<App>>({ rawBody: true });
    app.setGlobalPrefix('api');
    const auth = {
      validateApiKey: (raw: string) => {
        if (!Object.values(ApiKeyRole).includes(raw as ApiKeyRole)) throw new UnauthorizedException();
        return Promise.resolve({
          id: 'actor',
          keyHash: 'fixture-hash',
          name: 'Fixture',
          role: raw,
          allowedSessions: ['allowed'],
        } as ApiKey);
      },
      findUserByApiKeyId: () =>
        Promise.resolve({
          role: 'user',
          isActive: true,
          subscriptionStatus: 'trial',
          subscriptionExpiresAt: new Date('2099-01-01'),
        }),
      hasPermission: (key: ApiKey, role: ApiKeyRole) =>
        AuthService.prototype.hasPermission.call({} as AuthService, key, role),
    };
    app.useGlobalGuards(
      new ApiKeyGuard(auth as unknown as AuthService, new Reflector(), new ConfigService(), {
        logWarn: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditService),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const service of Object.values(services)) for (const mock of Object.values(service)) mock.mockClear();
  });

  it.each(routes)('$verb $path rejects another customer session before calling $service.$method', async route => {
    await request(app.getHttpServer())
      [route.verb](`/api/sessions/other/${route.path}`)
      .set('X-API-Key', 'admin')
      .send(payload)
      .expect(403);
    expect(services[route.service][route.method]).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      [route.verb](`/api/sessions/allowed/${route.path}`)
      .set('X-API-Key', route.role ?? 'operator')
      .send(payload)
      .expect(route.status ?? (route.verb === 'post' ? 201 : 200));
    expect(services[route.service][route.method]).toHaveBeenCalledTimes(1);
    if (route.method === 'updateAgent')
      expect(services.ai.updateAgent).toHaveBeenCalledWith('item', payload, 'allowed');
    if (route.method === 'deleteAgent') expect(services.ai.deleteAgent).toHaveBeenCalledWith('item', 'allowed');
    if (!['extractDocument', 'updateAgent', 'deleteAgent', 'execute'].includes(route.method))
      expect((services[route.service][route.method].mock.calls as unknown[][])[0][0]).toBe('allowed');
    if (route.role) {
      services[route.service][route.method].mockClear();
      await request(app.getHttpServer())
        [route.verb](`/api/sessions/allowed/${route.path}`)
        .set('X-API-Key', 'viewer')
        .send(payload)
        .expect(403);
      expect(services[route.service][route.method]).not.toHaveBeenCalled();
    }
  });
  it('binds OAuth callbacks to the actor hash and keeps dry-run chat fallbacks explicit', async () => {
    await request(app.getHttpServer())
      .post('/api/sessions/allowed/studio-connections/item/oauth/complete')
      .set('X-API-Key', 'admin')
      .send(payload)
      .expect(201);
    expect(services.connections.completeOAuth).toHaveBeenCalledWith(
      'allowed',
      'item',
      oauthHash('actor:fixture-hash'),
      payload,
    );
    await request(app.getHttpServer())
      .post('/api/sessions/allowed/studio-workflows/item/test')
      .set('X-API-Key', 'operator')
      .send({ message: 'fallback' })
      .expect(201);
    expect(services.workflows.execute).toHaveBeenCalledWith(
      { result: 'get' },
      'fallback',
      'test@c.us',
      undefined,
      undefined,
    );
    expect(() =>
      new StudioWorkflowController(services.workflows as unknown as StudioWorkflowService).generate(
        'allowed',
        {} as never,
      ),
    ).toThrow('planner is unavailable');
  });
  it('allows provider callbacks without an application key but retains provider verification', async () => {
    await request(app.getHttpServer())
      .get('/api/whatsapp-cloud-menus/menu?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/whatsapp-cloud-menus/menu?hub.mode=subscribe&hub.verify_token=provider-verify&hub.challenge=challenge')
      .expect(200, 'challenge');
    const raw = '{"provider":"fixture"}';
    await request(app.getHttpServer())
      .post('/api/whatsapp-cloud-menus/menu')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'provider-signature')
      .send(raw)
      .expect(200, { received: true });
    expect(services.cloud.receive).toHaveBeenCalledWith('menu', 'provider-signature', Buffer.from(raw));
    await request(app.getHttpServer()).post('/api/whatsapp-cloud-menus/menu').send({}).expect(401);
    await request(app.getHttpServer())
      .post('/api/studio-hooks/workflow')
      .set('x-workflow-token', 'workflow-secret')
      .send(payload)
      .expect(202, { accepted: true });
    await request(app.getHttpServer()).post('/api/studio-hooks/workflow').send(payload).expect(401);
  });
});

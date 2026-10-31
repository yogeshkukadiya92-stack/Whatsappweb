// Structural guard for the global-route authorization class of bug.
//
// The ApiKeyGuard resolves the scoped sessionId from ROUTE PARAMS only (api-key.guard.ts), and
// auth.service.ts short-circuits its allowedSessions check when no session id is present. So a route
// with NO session dimension admits a session-restricted key by default — the model is fail-open.
// The fence for those routes is @RequireUnscopedKey (auth.decorators.ts).
//
// This test fails when a controller handler is deployment-global (no :sessionId route param, not on
// a @SessionScoped controller) and carries neither @RequireUnscopedKey, @Public, nor an entry in
// ALLOWLIST below — so a future endpoint cannot silently re-introduce the gap.
import { readdirSync, readFileSync } from 'fs';
import { basename, join, sep } from 'path';
import ts from 'typescript';

/**
 * Handlers that are deliberately global AND deliberately reachable by a session-restricted key,
 * because they enforce the key's scope themselves in the handler or the service beneath it.
 * Key format: `<controller file basename> :: <handler name>`. Every entry needs a reason.
 */
const ALLOWLIST = new Map<string, string>([
  ['user-auth.controller.ts :: getProfile', 'returns only the caller key and its linked account, never another tenant'],
  [
    'supabase-auth.controller.ts :: link',
    'attaches a verified identity to the calling credential without widening its role or scope',
  ],
  [
    'scheduled-message.controller.ts :: listAll',
    'passes the caller session allowlist to findAll; an empty customer scope returns no records',
  ],
  ['billing.controller.ts :: status', 'only returns the authenticated account and public plan catalog'],
  ['billing.controller.ts :: checkout', 'resolves the customer from the authenticated key'],
  ['billing.controller.ts :: verify', 'checks order ownership against the authenticated customer'],
  ['audit.controller.ts :: findAll', 'scope-filters rows via resolveSessionScope'],
  ['webhooks-list.controller.ts :: findAll', 'scope-filters rows via the calling key'],
  ['webhooks-list.controller.ts :: deliveryFailures', 'scope-filters rows via the calling key'],
  ['search.controller.ts :: search', 'scope-filters results via the calling key'],
  ['session.controller.ts :: findAll', 'scope-filters sessions to the key allowlist'],
  ['session.controller.ts :: getStats', 'scope-filters the aggregate to apiKey.allowedSessions in the service'],
  // Integration instances live under :pluginId/:instanceId (not a session param), so the guard's
  // route-param fence cannot reach them. Every handler below re-scopes itself against the calling
  // key: reads resolve via sessionScopeVisible (out-of-scope ⇒ 404), writes via assertScopeWritable.
  ['integration-instance.controller.ts :: list', 'filters rows with sessionScopeVisible'],
  ['integration-instance.controller.ts :: getOne', 'resolveVisible() ⇒ 404 outside the key scope'],
  ['integration-instance.controller.ts :: create', 'assertScopeWritable(apiKey, sessionScope) before persisting'],
  ['integration-instance.controller.ts :: regenerate', 'resolveVisible() ⇒ 404 outside the key scope'],
  ['integration-instance.controller.ts :: patch', 'resolveVisible() + assertScopeWritable before any write'],
  ['integration-instance.controller.ts :: remove', 'resolveVisible() ⇒ 404 outside the key scope'],
  ['redrive.controller.ts :: redriveInstance', 'fails closed for scoped keys: missing/out-of-scope instance ⇒ 404'],
  // Self-validation only: the route returns {valid, role} for the calling key and reads/writes no
  // resource, so a session-restricted key validating itself is harmless (it cannot broaden scope).
  ['auth-validate.controller.ts :: validate', 'self-validation of the calling key; no resource access'],
]);

/**
 * Return the names of handlers in `source` that look deployment-global but carry no fence.
 * A handler is considered fenced when it (or its class) has @RequireUnscopedKey or @Public, and
 * session-dimensioned when it declares a `:sessionId` route param or the class is @SessionScoped.
 */
export function handlersMissingGlobalFence(source: string): string[] {
  const file = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const decorators = (node: ts.Node): string =>
    ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []).map(d => d.getText(file)).join('\n') : '';
  const offenders: string[] = [];
  for (const node of file.statements) {
    if (!ts.isClassDeclaration(node)) continue;
    // Each controller has its own metadata, even when several share a source file.
    const metadata = decorators(node);
    const classScoped = /@SessionScoped\(\)/.test(metadata);
    const classFenced = /@(RequireUnscopedKey|Public)\(\)/.test(metadata);
    const sessionPrefix = /@Controller\([^)]*:sessionId/.test(metadata);
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const handler = decorators(member);
      if (!/@(Get|Post|Put|Patch|Delete|All|Sse|Head)\(/.test(handler)) continue;
      if (classFenced || sessionPrefix || /@(RequireUnscopedKey|Public)\(\)/.test(handler)) continue;
      if (/@(Get|Post|Put|Patch|Delete|All|Sse|Head)\([^)]*:sessionId/.test(handler)) continue;
      if (classScoped && /@(Get|Post|Put|Patch|Delete|All|Sse|Head)\([^)]*:id/.test(handler)) continue;
      offenders.push(member.name.getText(file));
    }
  }
  return offenders;
}

function listControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listControllerFiles(full));
    else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('deployment-global routes are fenced against session-restricted keys', () => {
  // The checker itself must actually detect the gap — a structural guard that cannot fail proves nothing.
  it('flags a global handler with no fence', () => {
    const vulnerable = `
export class ThingController {
  @Get('everything')
  @RequireRole(ApiKeyRole.ADMIN)
  findAll(): string[] {
    return [];
  }
}
`;
    expect(handlersMissingGlobalFence(vulnerable)).toEqual(['findAll']);
  });

  it('flags an @All handler with no fence', () => {
    const vulnerable = `
export class ThingController {
  @All('everything')
  @RequireRole(ApiKeyRole.ADMIN)
  handleAll(): string[] {
    return [];
  }
}
`;
    expect(handlersMissingGlobalFence(vulnerable)).toEqual(['handleAll']);
  });

  it('flags a handler indented deeper than two spaces', () => {
    const vulnerable = `
export class ThingController {
    @Get('everything')
    @RequireRole(ApiKeyRole.ADMIN)
    findAll(): string[] {
        return [];
    }
}
`;
    expect(handlersMissingGlobalFence(vulnerable)).toEqual(['findAll']);
  });

  it('clears a handler carrying the fence', () => {
    const fixed = `
export class ThingController {
  @Get('everything')
  @RequireRole(ApiKeyRole.ADMIN)
  @RequireUnscopedKey()
  findAll(): string[] {
    return [];
  }
}
`;
    expect(handlersMissingGlobalFence(fixed)).toEqual([]);
  });

  it('clears a handler scoped by a :sessionId route param', () => {
    const scoped = `
export class ThingController {
  @Get('sessions/:sessionId/things')
  findForSession(): string[] {
    return [];
  }
}
`;
    expect(handlersMissingGlobalFence(scoped)).toEqual([]);
  });

  it('clears every handler on a class-level fenced controller', () => {
    const fenced = `
@Controller('infra')
@RequireUnscopedKey()
export class InfraController {
  @Get('everything')
  findAll(): string[] {
    return [];
  }
}
`;
    expect(handlersMissingGlobalFence(fenced)).toEqual([]);
  });

  it('clears a public handler', () => {
    const open = `
export class ThingController {
  @Get('health')
  @Public()
  health(): string {
    return 'ok';
  }
}
`;
    expect(handlersMissingGlobalFence(open)).toEqual([]);
  });

  it('keeps separate controller prefixes separate within the same file', () => {
    expect(
      handlersMissingGlobalFence(`
@Controller('global')
export class GlobalController {
  @Get() listAll() {}
}
@Controller('sessions/:sessionId/messages')
export class SessionController {
  @Get() list() {}
  @Post() create() {}
}
`),
    ).toEqual(['listAll']);
  });

  it('does not let an earlier class fence hide an unfenced later controller', () => {
    expect(
      handlersMissingGlobalFence(`
@Controller('admin')
@RequireUnscopedKey()
export class AdminController {
  @Get() list() {}
}
@Controller('global')
export class GlobalController {
  @Get() listAll() {}
}
`),
    ).toEqual(['listAll']);
  });

  it('no real controller exposes an unfenced deployment-global route', () => {
    const modulesDir = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of listControllerFiles(modulesDir)) {
      // Derive the file name through `path`, and normalize separators before matching: `join()`
      // yields backslashes on Windows, so splitting on '/' left the whole path as the "basename",
      // no ALLOWLIST key ever matched, and every allowlisted controller was reported as an offender.
      const fileName = basename(file);
      const posixPath = file.split(sep).join('/');
      for (const handler of handlersMissingGlobalFence(readFileSync(file, 'utf8'))) {
        const key = `${fileName} :: ${handler}`;
        if (ALLOWLIST.has(key)) continue;
        offenders.push(`${posixPath.replace(/.*\/src\//, 'src/')} :: ${handler}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

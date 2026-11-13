// Structural guard for the cross-tenant scoping class of bug (audit + webhook delivery-failures).
//
// The ApiKeyGuard session fence resolves the scoped sessionId from ROUTE PARAMS only
// (api-key.guard.ts). So any handler that instead accepts `sessionId` as a QUERY param is NOT
// scoped by the guard, and must derive scope from the calling key itself — the established pattern is
// to inject `@CurrentApiKey()` and pass `apiKey.allowedSessions` to the service (see
// search.controller / webhooks-list findAll / audit). This test fails if a controller handler takes
// `@Query('sessionId')` without also injecting `@CurrentApiKey`, so a future endpoint cannot silently
// re-introduce the leak.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import ts from 'typescript';

// Parse the syntax tree so inline decorators, nested parameter types and formatting cannot
// hide a handler from this authorization check. Standalone method fixtures are wrapped in a class.
function controllerMethods(source: string): ts.MethodDeclaration[] {
  const code = /\bclass\s/.test(source) ? source : `class Fixture { ${source} }`;
  const file = ts.createSourceFile('controller.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const methods: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node)) methods.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return methods;
}

function decoratorCalls(node: ts.Node): ts.CallExpression[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).map(d => d.expression).filter(ts.isCallExpression);
}

export function handlersMissingSessionScope(source: string): string[] {
  return controllerMethods(source)
    .filter(method => {
      const decorators = method.parameters.flatMap(decoratorCalls);
      const takesSession = decorators.some(
        call =>
          call.expression.getText() === 'Query' &&
          call.arguments.some(arg => ts.isStringLiteral(arg) && arg.text === 'sessionId'),
      );
      const injectsKey = decorators.some(call => call.expression.getText() === 'CurrentApiKey');
      return takesSession && !injectsKey;
    })
    .map(method => method.name.getText());
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

describe('query-param sessionId endpoints are session-scoped', () => {
  // The checker itself must actually detect the leak — a structural guard that can't fail proves nothing.
  it('flags a handler that takes @Query(sessionId) without @CurrentApiKey', () => {
    const vulnerable = `
  async findAll(
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    return this.svc.findAll(sessionId);
  }
`;
    expect(handlersMissingSessionScope(vulnerable)).toEqual(['findAll']);
  });

  it('flags a vulnerable handler that declares no return type', () => {
    // The guard is only worth what it can see. A handler written without an explicit return type is
    // just as exposed, and for most of this file's life the checker skipped every one of them.
    const vulnerable = `
  async findAll(
    @Query('sessionId') sessionId?: string,
  ) {
    return this.svc.findAll(sessionId);
  }
`;
    expect(handlersMissingSessionScope(vulnerable)).toEqual(['findAll']);
  });

  it('checks inline handlers and nested parameter types, and ignores comment decoys', () => {
    const source = `class Controller {
      @Get() list(@Query('sessionId') session: string, @Body() dto: { nested: { id: string } }) {}
      @Post() safe(@Query('sessionId') session: string, @CurrentApiKey() key: ApiKey) {}
      @Get() decoy(@Query('sessionId') session: string) { /* @CurrentApiKey() */ }
    }`;
    expect(handlersMissingSessionScope(source)).toEqual(['list', 'decoy']);
  });

  it('clears a handler that injects @CurrentApiKey alongside the query param', () => {
    const fixed = `
  async findAll(
    @CurrentApiKey() apiKey?: ApiKey,
    @Query('sessionId') sessionId?: string,
  ): Promise<unknown> {
    return this.svc.findAll(sessionId, apiKey?.allowedSessions);
  }
`;
    expect(handlersMissingSessionScope(fixed)).toEqual([]);
  });

  // A structural guard that silently stops covering things is worse than no guard, because the green
  // result reads as "no endpoint leaks" rather than "no endpoint I looked at leaks". This pairs every
  // HTTP-verb decorator with the method the checker would examine for it, and fails if any decorator
  // has none — which is what a matcher that cannot parse a handler's shape looks like from outside.
  it('examines every decorated handler, so a clean result means the whole surface', () => {
    const modulesDir = join(__dirname, '..');
    const blind: string[] = [];
    let decorated = 0;
    for (const file of listControllerFiles(modulesDir)) {
      const source = readFileSync(file, 'utf8');
      const decorators = [...source.matchAll(/^ {2}@(?:Get|Post|Put|Patch|Delete|All|Head|Options)\(/gm)];
      const positions = controllerMethods(source).flatMap(method =>
        decoratorCalls(method)
          .filter(call => /^(Get|Post|Put|Patch|Delete|All|Head|Options)$/.test(call.expression.getText()))
          .map(call => call.getStart() - 1),
      );
      for (const decorator of decorators) {
        decorated++;
        const at = (decorator.index ?? 0) + 2;
        if (!positions.includes(at)) blind.push(`${file} :: ${decorator[0].trim()}`);
      }
    }
    expect(decorated).toBeGreaterThan(100); // the count itself must not silently collapse to zero
    expect(blind).toEqual([]);
  });

  it('no real controller takes @Query(sessionId) without scoping to the calling key', () => {
    const modulesDir = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of listControllerFiles(modulesDir)) {
      for (const handler of handlersMissingSessionScope(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.replace(/.*\/src\//, 'src/')} :: ${handler}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

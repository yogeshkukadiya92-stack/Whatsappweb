import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function check(mutator = () => {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'openwa-sdk-coverage-'));
  try {
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'sdk'));
    copyFileSync(join(root, 'scripts/check-sdk-coverage.mjs'), join(fixture, 'scripts/check-sdk-coverage.mjs'));
    copyFileSync(join(root, 'sdk/README.md'), join(fixture, 'sdk/README.md'));
    copyFileSync(join(root, 'openapi.json'), join(fixture, 'openapi.json'));
    for (const language of ['javascript', 'python', 'php', 'java', 'go']) {
      symlinkSync(join(root, 'sdk', language), join(fixture, 'sdk', language), 'dir');
    }
    mutator(fixture);
    return spawnSync(process.execPath, [join(fixture, 'scripts/check-sdk-coverage.mjs')], { encoding: 'utf8' });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}

test('all SDKs cover the documented resource scope', () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});

test('an undocumented billing exclusion fails rather than hiding missing SDK methods', () => {
  const result = check(dir => {
    const path = join(dir, 'sdk/README.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('`billing`', 'billing'));
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /billing\/settings/);
});

test('a missing verb on a supported core SDK resource still fails', () => {
  const result = check(dir => {
    const path = join(dir, 'openapi.json');
    const spec = JSON.parse(readFileSync(path, 'utf8'));
    spec.paths['/api/health/ready'].post = { responses: { 200: { description: 'fixture' } } };
    writeFileSync(path, JSON.stringify(spec));
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /POST \/api\/health\/ready/);
});

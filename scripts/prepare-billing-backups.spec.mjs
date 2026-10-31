import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('deploy/waply-two-instance/prepare-billing-backups.sh');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'waply-billing-backup-'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
if [ "$1" = inspect ]; then echo true; exit 0; fi
case "$*" in
  *pg_restore*) cat >/dev/null; echo '; validated fixture archive'; exit 0 ;;
  *'exec pg_dump'*)
    for arg do database="$arg"; done
    if [ "$database" = "$FAIL_DUMP_DATABASE" ]; then echo 'fixture database failure' >&2; exit 7; fi
    echo "private archive for $database"; exit 0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o700 });
  // Portable hash utility for this Linux host script's macOS test fixture.
  writeFileSync(join(bin, 'sha256sum'), `#!/usr/bin/env node
const fs=require('fs'),crypto=require('crypto');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(process.argv[2]==='--check') { for(const line of fs.readFileSync(process.argv[3],'utf8').trim().split('\\n')) {const [sum,file]=line.split(/\\s+/);if(hash(file)!==sum)process.exit(1);console.log(file+': OK');} }
else console.log(hash(process.argv[2])+'  '+process.argv[2]);
`, { mode: 0o700 });
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WAPLY_BILLING_BACKUP_ROOT: join(root, 'backups') } };
}

test('backup preparation saves private archives, validates both and records the reviewed release', () => {
  const { root, env } = fixture();
  try {
    const run = spawnSync('bash', [script, 'abcdef1234567'], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const output = join(env.WAPLY_BILLING_BACKUP_ROOT, readdirSync(env.WAPLY_BILLING_BACKUP_ROOT)[0]);
    assert.equal(statSync(output).mode & 0o777, 0o700);
    assert.equal(readFileSync(join(output, 'release-commit.txt'), 'utf8'), 'abcdef1234567\n');
    for (const name of ['waply_main.dump','waply_data.dump']) assert.equal(statSync(join(output, name)).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(output,'SHA256SUMS'),'utf8').trim().split('\n').length, 2);
    assert.match(run.stdout, /No deployment or service restart/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('a failed dump stops before any release-ready result and leaves the partial file distinguishable', () => {
  const { root, env } = fixture();
  try {
    const run = spawnSync('bash', [script, 'abcdef1234567'], { env: { ...env, FAIL_DUMP_DATABASE:'waply_data' }, encoding:'utf8' });
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /Validated backup archives/);
    const output = join(env.WAPLY_BILLING_BACKUP_ROOT,readdirSync(env.WAPLY_BILLING_BACKUP_ROOT)[0]);
    assert.ok(readdirSync(output).includes('waply_main.dump'));
    assert.ok(readdirSync(output).includes('waply_data.dump.partial'));
    assert.ok(!readdirSync(output).includes('waply_data.dump'));
  } finally { rmSync(root,{ recursive:true,force:true }); }
});
test('backup preparation refuses an unreviewed release identifier before touching Docker or disk', () => {
  const { root, env } = fixture();
  try {
    const run = spawnSync('bash',[script,'not-a-commit'],{ env,encoding:'utf8' });
    assert.equal(run.status,2);
    assert.match(run.stderr,/Usage:/);
    assert.deepEqual(readdirSync(root),['bin']);
  } finally { rmSync(root,{ recursive:true,force:true }); }
});

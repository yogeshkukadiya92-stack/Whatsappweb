#!/usr/bin/env node
/**
 * Offline, one-way copy of Waply application rows into schema-migrated PostgreSQL.
 * Run once per database (main and data) from a consistent SQLite snapshot after the
 * source application's writers have stopped. This script never changes the source.
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const q = value => `"${value.replaceAll('"', '""')}"`;
const allowedOmissions = new Set([
  'migrations', // PostgreSQL has its own migration ledger.
  'scheduled_messages_legacy_1787600000000', // Archived by a repair migration; kept in SQLite backup.
]);
const isFtsTable = name => name === 'messages_fts' || name.startsWith('messages_fts_');

async function migrate({ sqlitePath, pgUrl, kind, stopped }) {
  if (!stopped || !['main', 'data'].includes(kind) || !sqlitePath || !pgUrl) {
    throw new Error('Usage: --kind=main|data --sqlite=/path/to/snapshot.sqlite --pg-url=postgres://... --writers-stopped');
  }
  const resolvedPath = path.resolve(sqlitePath);
  if (!fs.statSync(resolvedPath).isFile()) throw new Error('SQLite snapshot must be a file');
  const source = new Database(resolvedPath, { readonly: true, fileMustExist: true });
  const target = new Client({ connectionString: pgUrl, connectionTimeoutMillis: 10000 });
  let transaction = false;
  try {
    const check = source.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`SQLite quick_check failed: ${check}`);
    await target.connect();
    const identity = await target.query('SELECT current_database() AS database, current_schema() AS schema');
    if (identity.rows[0].database === 'postgres' || identity.rows[0].schema !== 'public') {
      throw new Error('Destination must be a dedicated Waply database with public schema');
    }
    const targetTablesResult = await target.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`);
    const targetTables = new Set(targetTablesResult.rows.map(row => row.table_name));
    const requiredTable = kind === 'main' ? 'api_keys' : 'sessions';
    if (!targetTables.has(requiredTable)) throw new Error(`Destination is not a migrated ${kind} database`);
    const sourceTables = source.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(row => row.name);
    const businessTables = sourceTables.filter(name => !allowedOmissions.has(name) && !isFtsTable(name));
    for (const table of businessTables) {
      if (!targetTables.has(table)) {
        const count = source.prepare(`SELECT count(*) AS n FROM ${q(table)}`).get().n;
        if (count) throw new Error(`PostgreSQL is missing populated source table: ${table} (${count} rows)`);
        console.log(`${table}: 0 (obsolete source table omitted)`);
      }
    }
    const copyTables = businessTables.filter(table => targetTables.has(table));
    for (const table of targetTables) {
      if (table === 'migrations') continue;
      const result = await target.query(`SELECT 1 FROM ${q(table)} LIMIT 1`);
      if (result.rowCount) throw new Error(`Destination table ${table} is not empty`);
    }

    const deps = await target.query(`SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid=constraint_row.conrelid
      JOIN pg_class parent ON parent.oid=constraint_row.confrelid
      JOIN pg_namespace namespace ON namespace.oid=child.relnamespace
      WHERE constraint_row.contype='f' AND namespace.nspname=current_schema()`);
    const parents = new Map(copyTables.map(name => [name, new Set()]));
    for (const { child, parent } of deps.rows) {
      if (parents.has(child) && parents.has(parent)) parents.get(child).add(parent);
    }
    const ordered = [];
    while (parents.size) {
      const ready = [...parents].filter(([, parentSet]) => [...parentSet].every(name => !parents.has(name)));
      if (!ready.length) throw new Error('Foreign-key cycle requires a dedicated migration');
      for (const [name] of ready) { ordered.push(name); parents.delete(name); }
    }

    await target.query('BEGIN');
    transaction = true;
    await target.query('SET LOCAL statement_timeout = 0');
    for (const table of ordered) {
      const targetColumnsResult = await target.query(`SELECT column_name, data_type, is_generated
        FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1`, [table]);
      const targetColumns = new Map(targetColumnsResult.rows.map(row => [row.column_name, row]));
      const sourceColumns = source.pragma(`table_info(${q(table)})`).map(row => row.name);
      const columns = sourceColumns.filter(name => targetColumns.has(name) && targetColumns.get(name).is_generated === 'NEVER');
      const unmapped = sourceColumns.filter(name => !targetColumns.has(name));
      if (unmapped.length) throw new Error(`${table}: unmapped SQLite columns: ${unmapped.join(', ')}`);
      const count = source.prepare(`SELECT count(*) AS n FROM ${q(table)}`).get().n;
      if (!count) { console.log(`${table}: 0`); continue; }
      if (!columns.length) throw new Error(`${table}: no copyable columns`);
      const select = source.prepare(`SELECT ${columns.map(q).join(', ')} FROM ${q(table)}`);
      const batchSize = Math.max(1, Math.min(100, Math.floor(30000 / columns.length)));
      let batch = [], copied = 0;
      const insertBatch = async () => {
        if (!batch.length) return;
        const placeholders = batch.map((_, rowIndex) => `(${columns.map((__, colIndex) => '$' + (rowIndex * columns.length + colIndex + 1)).join(',')})`).join(',');
        const values = batch.flatMap(row => columns.map(name => {
          const value = row[name];
          if (value === null || value === undefined) return null;
          if (targetColumns.get(name).data_type === 'boolean') {
            if (value === 1 || value === '1' || value === true) return true;
            if (value === 0 || value === '0' || value === false) return false;
            throw new Error(`${table}.${name}: invalid SQLite boolean`);
          }
          if (Buffer.isBuffer(value) && targetColumns.get(name).data_type !== 'bytea') {
            throw new Error(`${table}.${name}: SQLite BLOB has no PostgreSQL bytea destination`);
          }
          return value;
        }));
        await target.query(`INSERT INTO ${q(table)} (${columns.map(q).join(',')}) VALUES ${placeholders}`, values);
        copied += batch.length;
        batch = [];
      };
      for (const row of select.iterate()) {
        batch.push(row);
        if (batch.length === batchSize) await insertBatch();
      }
      await insertBatch();
      const result = await target.query(`SELECT count(*)::integer AS n FROM ${q(table)}`);
      if (copied !== count || result.rows[0].n !== count) throw new Error(`${table}: row-count mismatch`);
      console.log(`${table}: ${copied}`);
    }
    if (kind === 'data' && targetTables.has('sessions')) {
      // The source node has stopped. Let the new nodes atomically claim on first start.
      await target.query(`UPDATE sessions SET "nodeId"=NULL,"nodeUrl"=NULL,
        "claimedAt"=NULL,"leaseExpiresAt"=NULL`);
    }
    await target.query('COMMIT');
    transaction = false;
    console.log(`Committed ${kind} SQLite snapshot to PostgreSQL`);
  } catch (error) {
    if (transaction) await target.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    source.close();
    await target.end().catch(() => undefined);
  }
}

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('='))
  .map(arg => { const split = arg.indexOf('='); return [arg.slice(2, split), arg.slice(split + 1)]; }));
migrate({
  sqlitePath: args.sqlite,
  pgUrl: args['pg-url'],
  kind: args.kind,
  stopped: process.argv.includes('--writers-stopped'),
}).catch(error => { console.error(error.message); process.exitCode = 1; });

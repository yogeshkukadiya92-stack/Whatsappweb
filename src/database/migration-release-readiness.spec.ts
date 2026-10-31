import { AddAiAgentTargeting1786300000000 } from './migrations/1786300000000-AddAiAgentTargeting';
import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { readdirSync } from 'fs';
import { join } from 'path';
import { RepairWorkspaceUuidDefaults1793500000000 } from './migrations/1793500000000-RepairWorkspaceUuidDefaults';

const migrations = (directory: string): Array<new () => MigrationInterface> =>
  readdirSync(directory)
    .filter(file => file.endsWith('.ts'))
    .sort()
    .map(file => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require(join(directory, file)) as Record<string, unknown>;
      const migration = Object.values(loaded).find(
        (value): value is new () => MigrationInterface =>
          typeof value === 'function' &&
          typeof (value as { prototype?: { up?: unknown } }).prototype?.up === 'function',
      );
      if (!migration) throw new Error(`Missing migration in ${file}`);
      return migration;
    });

describe('release migration replay on disposable databases', () => {
  it('boots the complete SQLite data chain without synchronization and preserves rows on replay', async () => {
    const db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      migrations: migrations(join(__dirname, 'migrations')),
      synchronize: false,
    });
    await db.initialize();
    try {
      expect((await db.runMigrations({ transaction: 'all' })).length).toBeGreaterThan(30);
      for (const table of [
        'scheduled_messages',
        'studio_connections',
        'studio_workflows',
        'cloud_menu_connections',
        'cloud_menu_receipts',
        'ai_agents',
        'ai_bot_configs',
        'lead_flows',
      ])
        expect(await db.createQueryRunner().hasTable(table)).toBe(true);
      await db.query('INSERT INTO sessions (id, name, status) VALUES (?, ?, ?)', [
        'preserved',
        'Existing customer session',
        'disconnected',
      ]);
      await db.query(
        'INSERT INTO scheduled_messages (id, session_id, recipient, message_type, scheduled_at, details) VALUES (?, ?, ?, ?, ?, ?)',
        ['schedule', 'preserved', 'fixture@c.us', 'text', '2030-01-01T00:00:00Z', '{}'],
      );
      expect(await db.runMigrations()).toEqual([]);
      expect(await db.query('SELECT name FROM sessions WHERE id = ?', ['preserved'])).toEqual([
        { name: 'Existing customer session' },
      ]);
      expect(await db.query('SELECT id FROM scheduled_messages')).toEqual([{ id: 'schedule' }]);
      const columns = await db.query<Array<{ name: string }>>('PRAGMA table_info(message_batches)');
      expect(columns.map(column => column.name)).toEqual(expect.arrayContaining(['scheduled_at', 'session_id']));
    } finally {
      await db.destroy();
    }
  });
  it('creates and reverses the new billing table without removing existing auth records', async () => {
    const db = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      migrations: migrations(join(__dirname, 'migrations-main')),
      synchronize: false,
    });
    await db.initialize();
    try {
      await db.runMigrations({ transaction: 'all' });
      await db.query('INSERT INTO api_keys (id, name, keyHash, keyPrefix, role) VALUES (?, ?, ?, ?, ?)', [
        'preserved-key',
        'Existing key',
        'fixture-hash',
        'fixture',
        'operator',
      ]);
      await db.query('INSERT INTO billing_records (id, payload) VALUES (?, ?)', ['settings', '{}']);
      await db.undoLastMigration({ transaction: 'all' });
      expect(await db.createQueryRunner().hasTable('billing_records')).toBe(false);
      expect(await db.query('SELECT id FROM api_keys')).toEqual([{ id: 'preserved-key' }]);
      await db.runMigrations();
      expect(await db.query('SELECT id FROM billing_records')).toEqual([]);
    } finally {
      await db.destroy();
    }
  });
  it('repairs only the three PostgreSQL generated identifiers and reverses each default explicitly', async () => {
    const query = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const runner = { connection: { options: { type: 'postgres' } }, query } as unknown as QueryRunner;
    const migration = new RepairWorkspaceUuidDefaults1793500000000();
    await migration.up(runner);
    expect(query.mock.calls.map(call => call[0])).toEqual(
      ['studio_connections', 'cloud_menu_connections', 'cloud_menu_receipts'].map(
        table => `ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::varchar`,
      ),
    );
    query.mockClear();
    await migration.down(runner);
    expect(query.mock.calls.map(call => call[0])).toEqual(
      ['studio_connections', 'cloud_menu_connections', 'cloud_menu_receipts'].map(
        table => `ALTER TABLE "${table}" ALTER COLUMN "id" DROP DEFAULT`,
      ),
    );
    query.mockClear();
    const sqlite = { connection: { options: { type: 'better-sqlite3' } }, query } as unknown as QueryRunner;
    await migration.up(sqlite);
    await migration.down(sqlite);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('legacy recipient-targeting migration reversibility', () => {
  it('adds targeting columns once, removes only those columns, and tolerates absent legacy tables', async () => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await db.initialize();
    const runner = db.createQueryRunner();
    const migration = new AddAiAgentTargeting1786300000000();
    try {
      await migration.up(runner);
      await migration.down(runner);
      await runner.query('CREATE TABLE ai_agents (id varchar PRIMARY KEY, name varchar NOT NULL)');
      await runner.query('INSERT INTO ai_agents (id, name) VALUES (?, ?)', ['kept', 'Existing agent']);
      await migration.up(runner);
      await migration.up(runner);
      expect((await runner.getTable('ai_agents'))?.columns.map(column => column.name)).toEqual([
        'id',
        'name',
        'targetNumbers',
        'audience',
        'messageTypes',
      ]);
      await migration.down(runner);
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM ai_agents')).toEqual([{ id: 'kept', name: 'Existing agent' }]);
    } finally {
      await runner.release();
      await db.destroy();
    }
  });
});

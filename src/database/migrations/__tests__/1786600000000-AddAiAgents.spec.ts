import { DataSource } from 'typeorm';
import { AddAiAgents1786600000000 } from '../1786600000000-AddAiAgents';

describe('AddAiAgents migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query(`CREATE TABLE "sessions" ("id" varchar PRIMARY KEY NOT NULL)`);
    await ds.query(`INSERT INTO "sessions" ("id") VALUES ('session-1')`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates a usable table and index, is idempotent, and reverses cleanly', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddAiAgents1786600000000();

    await migration.up(runner);
    await runner.query(
      `INSERT INTO "ai_agents" (` +
        `"id", "sessionId", "name", "triggerKeywords", "systemPrompt"` +
        `) VALUES (?, ?, ?, ?, ?)`,
      ['agent-1', 'session-1', 'Sales Bot', '["price","ભાવ"]', 'Help the customer'],
    );

    const agents = (await runner.query(`SELECT * FROM "ai_agents"`)) as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: 'agent-1',
      sessionId: 'session-1',
      role: 'sales',
      enabled: 1,
      priority: 0,
    });
    expect(
      await runner.query(`SELECT name FROM sqlite_master WHERE type='index' AND name='IDX_ai_agents_sessionId'`),
    ).toHaveLength(1);

    await expect(migration.up(runner)).resolves.toBeUndefined();
    await migration.down(runner);
    expect(await runner.hasTable('ai_agents')).toBe(false);
    await runner.release();
  });

  it('cascades agents when their WhatsApp session is deleted', async () => {
    const runner = ds.createQueryRunner();
    await new AddAiAgents1786600000000().up(runner);
    await runner.query(
      `INSERT INTO "ai_agents" ("id", "sessionId", "name", "triggerKeywords", "systemPrompt") ` +
        `VALUES ('agent-1', 'session-1', 'Support Bot', '[]', 'Help')`,
    );

    await runner.query(`DELETE FROM "sessions" WHERE "id" = 'session-1'`);
    expect(await runner.query(`SELECT * FROM "ai_agents"`)).toHaveLength(0);
    await runner.release();
  });
});

import { DataSource } from 'typeorm';
import { RepairLegacyScheduledMessages1787600000000 } from '../1787600000000-RepairLegacyScheduledMessages';

describe('legacy scheduler schema repair', () => {
  let ds: DataSource;
  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query('CREATE TABLE scheduled_messages (id varchar PRIMARY KEY, sessionId varchar NOT NULL, chatId varchar NOT NULL, type varchar NOT NULL, payload TEXT NOT NULL, scheduledAt datetime NOT NULL, status varchar NOT NULL)');
  });
  afterEach(async () => { await ds.destroy(); });
  it('repairs an empty legacy table without deleting the original and is repeatable', async () => {
    const runner = ds.createQueryRunner();
    const migration = new RepairLegacyScheduledMessages1787600000000();
    await migration.up(runner);
    expect(await runner.hasColumn('scheduled_messages', 'scheduled_at')).toBe(true);
    expect(await runner.hasTable('scheduled_messages_legacy_1787600000000')).toBe(true);
    await migration.up(runner);
    await ds.query('INSERT INTO scheduled_messages (id,session_id,recipient,message_type,details,scheduled_at) VALUES (?,?,?,?,?,?)', ['1','session','123@c.us','text','{"content":"hello"}',new Date().toISOString()]);
    expect((await ds.query('SELECT COUNT(*) AS count FROM scheduled_messages'))[0].count).toBe(1);
  });
  it('preserves populated legacy tables instead of guessing their payload format', async () => {
    await ds.query('INSERT INTO scheduled_messages VALUES (?,?,?,?,?,?,?)', ['1','s','c','text','{}','2026-09-22','pending']);
    await expect(new RepairLegacyScheduledMessages1787600000000().up(ds.createQueryRunner())).rejects.toThrow('contains data');
    expect((await ds.query('SELECT COUNT(*) AS count FROM scheduled_messages'))[0].count).toBe(1);
  });
});

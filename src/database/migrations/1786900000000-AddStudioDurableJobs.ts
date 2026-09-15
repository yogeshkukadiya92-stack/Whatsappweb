import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddStudioDurableJobs1786900000000 implements MigrationInterface {
  name = 'AddStudioDurableJobs1786900000000';
  async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('studio_workflows');
    if (!table) return;
    for (const [name, sql] of [
      ['nextScheduleAt', 'varchar'],
      ['webhookTokenHash', 'varchar'],
      ['webhookEnabled', 'boolean NOT NULL DEFAULT false'],
    ])
      if (!table.findColumnByName(name)) await q.query(`ALTER TABLE "studio_workflows" ADD COLUMN "${name}" ${sql}`);
    if (!(await q.hasTable('studio_jobs'))) {
      const pg = q.dataSource.options.type === 'postgres';
      await q.query(
        `CREATE TABLE "studio_jobs" ("id" varchar PRIMARY KEY NOT NULL ${pg ? 'DEFAULT gen_random_uuid()::varchar' : ''}, "sessionId" varchar NOT NULL, "workflowId" varchar NOT NULL, "executionId" varchar NOT NULL, "definition" text, "state" text, "chatId" varchar NOT NULL, "status" varchar NOT NULL, "nextRunAt" varchar NOT NULL, "leaseUntil" varchar, "leaseOwner" varchar, "createdAt" ${pg ? 'timestamp NOT NULL DEFAULT NOW()' : "datetime NOT NULL DEFAULT (datetime('now'))"}, FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE)`,
      );
      await q.query('CREATE INDEX "IDX_studio_jobs_due" ON "studio_jobs" ("status", "nextRunAt")');
      await q.query('CREATE INDEX "IDX_studio_jobs_session" ON "studio_jobs" ("sessionId")');
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "studio_jobs"');
    for (const column of ['nextScheduleAt', 'webhookTokenHash', 'webhookEnabled'])
      await q.query(`ALTER TABLE "studio_workflows" DROP COLUMN "${column}"`);
  }
}

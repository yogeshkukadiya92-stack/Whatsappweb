import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAutomationStudio1786800000000 implements MigrationInterface {
  name = 'AddAutomationStudio1786800000000';
  async up(q: QueryRunner): Promise<void> {
    const postgres = q.dataSource.options.type === 'postgres';
    const timestamp = postgres ? 'timestamp NOT NULL DEFAULT NOW()' : "datetime NOT NULL DEFAULT (datetime('now'))";
    const id = postgres
      ? 'varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar'
      : 'varchar PRIMARY KEY NOT NULL';
    if (!(await q.hasTable('studio_workflows'))) {
      await q.query(
        `CREATE TABLE "studio_workflows" ("id" ${id}, "sessionId" varchar NOT NULL, "name" varchar(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "definition" text NOT NULL, "createdAt" ${timestamp}, "updatedAt" ${timestamp}, FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE)`,
      );
      await q.query(`CREATE INDEX "IDX_studio_workflows_session" ON "studio_workflows" ("sessionId")`);
    }
    if (!(await q.hasTable('studio_executions'))) {
      await q.query(
        `CREATE TABLE "studio_executions" ("id" ${id}, "sessionId" varchar NOT NULL, "workflowId" varchar NOT NULL, "workflowName" varchar(100) NOT NULL, "status" varchar NOT NULL, "test" boolean NOT NULL, "chatId" varchar, "trace" text NOT NULL, "durationMs" integer NOT NULL, "createdAt" ${timestamp})`,
      );
      await q.query(`CREATE INDEX "IDX_studio_executions_session" ON "studio_executions" ("sessionId")`);
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "studio_executions"');
    await q.query('DROP TABLE IF EXISTS "studio_workflows"');
  }
}

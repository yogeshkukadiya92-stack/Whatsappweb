import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiQueryCaptures1787300000000 implements MigrationInterface {
  name = 'AddAiQueryCaptures1787300000000';
  async up(q: QueryRunner): Promise<void> {
    if (await q.hasTable('ai_query_captures')) return;
    const pg = q.dataSource.options.type === 'postgres';
    await q.query(`CREATE TABLE "ai_query_captures" ("id" ${pg ? 'varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar' : 'varchar PRIMARY KEY NOT NULL'}, "sessionId" varchar NOT NULL, "agentId" varchar NOT NULL, "groupId" varchar(160), "groupName" varchar(160), "senderPhone" varchar(80), "query" text NOT NULL, "createdAt" ${pg ? 'timestamp NOT NULL DEFAULT NOW()' : "datetime NOT NULL DEFAULT (datetime('now'))"})`);
    await q.query(`CREATE INDEX "IDX_ai_query_captures_sessionId" ON "ai_query_captures" ("sessionId")`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE IF EXISTS "ai_query_captures"'); }
}

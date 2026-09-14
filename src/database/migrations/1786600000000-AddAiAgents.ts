import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the specialized AI agents table. The entity shipped before its production migration,
 * so synchronize-disabled databases returned 500 for every agents read/write request.
 */
export class AddAiAgents1786600000000 implements MigrationInterface {
  name = 'AddAiAgents1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('ai_agents')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "ai_agents" (` +
          `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
          `"sessionId" varchar NOT NULL, "name" varchar(100) NOT NULL, ` +
          `"role" varchar(50) NOT NULL DEFAULT 'sales', "enabled" boolean NOT NULL DEFAULT true, ` +
          `"priority" integer NOT NULL DEFAULT 0, "triggerKeywords" text NOT NULL, ` +
          `"description" text, "systemPrompt" text NOT NULL, "knowledgeBase" text, ` +
          `"createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `CONSTRAINT "FK_ai_agents_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "ai_agents" (` +
          `"id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, "name" varchar(100) NOT NULL, ` +
          `"role" varchar(50) NOT NULL DEFAULT 'sales', "enabled" boolean NOT NULL DEFAULT (1), ` +
          `"priority" integer NOT NULL DEFAULT (0), "triggerKeywords" text NOT NULL, ` +
          `"description" text, "systemPrompt" text NOT NULL, "knowledgeBase" text, ` +
          `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `"updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `CONSTRAINT "FK_ai_agents_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    }

    await queryRunner.query(`CREATE INDEX "IDX_ai_agents_sessionId" ON "ai_agents" ("sessionId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_agents_sessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_agents"`);
  }
}

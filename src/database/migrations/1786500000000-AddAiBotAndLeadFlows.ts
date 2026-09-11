import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiBotAndLeadFlows1786500000000 implements MigrationInterface {
  name = 'AddAiBotAndLeadFlows1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    // 1. ai_bot_configs
    if (!(await queryRunner.hasTable('ai_bot_configs'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "ai_bot_configs" (` +
            `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"enabled" boolean NOT NULL DEFAULT false, ` +
            `"provider" varchar(30) NOT NULL DEFAULT 'gemini', ` +
            `"apiKey" text NOT NULL DEFAULT '', ` +
            `"model" varchar(100) NOT NULL DEFAULT 'gemini-1.5-flash', ` +
            `"systemPrompt" text, ` +
            `"knowledgeBase" text, ` +
            `"cooldownSeconds" integer NOT NULL DEFAULT 10, ` +
            `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `"updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `CONSTRAINT "UQ_ai_bot_configs_sessionId" UNIQUE ("sessionId"), ` +
            `CONSTRAINT "FK_ai_bot_configs_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "ai_bot_configs" (` +
            `"id" varchar PRIMARY KEY NOT NULL, ` +
            `"sessionId" varchar NOT NULL UNIQUE, ` +
            `"enabled" boolean NOT NULL DEFAULT (0), ` +
            `"provider" varchar(30) NOT NULL DEFAULT 'gemini', ` +
            `"apiKey" text NOT NULL DEFAULT '', ` +
            `"model" varchar(100) NOT NULL DEFAULT 'gemini-1.5-flash', ` +
            `"systemPrompt" text, ` +
            `"knowledgeBase" text, ` +
            `"cooldownSeconds" integer NOT NULL DEFAULT (10), ` +
            `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `"updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `CONSTRAINT "FK_ai_bot_configs_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
        );
      }
      await queryRunner.query(`CREATE INDEX "IDX_ai_bot_configs_sessionId" ON "ai_bot_configs" ("sessionId")`);
    }

    // 2. lead_flows
    if (!(await queryRunner.hasTable('lead_flows'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "lead_flows" (` +
            `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"name" varchar(100) NOT NULL, ` +
            `"enabled" boolean NOT NULL DEFAULT true, ` +
            `"triggers" text NOT NULL, ` +
            `"steps" text NOT NULL, ` +
            `"completionMessage" text NOT NULL, ` +
            `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `"updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `CONSTRAINT "FK_lead_flows_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "lead_flows" (` +
            `"id" varchar PRIMARY KEY NOT NULL, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"name" varchar(100) NOT NULL, ` +
            `"enabled" boolean NOT NULL DEFAULT (1), ` +
            `"triggers" text NOT NULL, ` +
            `"steps" text NOT NULL, ` +
            `"completionMessage" text NOT NULL, ` +
            `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `"updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `CONSTRAINT "FK_lead_flows_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
        );
      }
      await queryRunner.query(`CREATE INDEX "IDX_lead_flows_sessionId" ON "lead_flows" ("sessionId")`);
    }

    // 3. lead_entries
    if (!(await queryRunner.hasTable('lead_entries'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "lead_entries" (` +
            `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"chatId" varchar NOT NULL, ` +
            `"flowId" varchar, ` +
            `"currentStepIndex" integer NOT NULL DEFAULT 0, ` +
            `"status" varchar(30) NOT NULL DEFAULT 'in_progress', ` +
            `"collectedData" text, ` +
            `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `"updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `CONSTRAINT "FK_lead_entries_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "lead_entries" (` +
            `"id" varchar PRIMARY KEY NOT NULL, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"chatId" varchar NOT NULL, ` +
            `"flowId" varchar, ` +
            `"currentStepIndex" integer NOT NULL DEFAULT (0), ` +
            `"status" varchar(30) NOT NULL DEFAULT 'in_progress', ` +
            `"collectedData" text, ` +
            `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `"updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `CONSTRAINT "FK_lead_entries_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
        );
      }
      await queryRunner.query(`CREATE INDEX "IDX_lead_entries_session_chat" ON "lead_entries" ("sessionId", "chatId")`);
      await queryRunner.query(`CREATE INDEX "IDX_lead_entries_sessionId" ON "lead_entries" ("sessionId")`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lead_entries_session_chat"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lead_entries_sessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lead_entries"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lead_flows_sessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lead_flows"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_bot_configs_sessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_bot_configs"`);
  }
}

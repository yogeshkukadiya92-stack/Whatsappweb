import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledMessages1786500000000 implements MigrationInterface {
  name = 'AddScheduledMessages1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduled_messages')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "scheduled_messages" (` +
          `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
          `"sessionId" varchar NOT NULL, ` +
          `"chatId" varchar NOT NULL, ` +
          `"type" varchar NOT NULL, ` +
          `"payload" text NOT NULL, ` +
          `"scheduledAt" timestamp NOT NULL, ` +
          `"status" varchar NOT NULL DEFAULT 'pending', ` +
          `"sentMessageId" varchar, ` +
          `"error" varchar, ` +
          `"sentAt" timestamp, ` +
          `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `"updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `CONSTRAINT "FK_scheduled_messages_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "scheduled_messages" (` +
          `"id" varchar PRIMARY KEY NOT NULL, ` +
          `"sessionId" varchar NOT NULL, ` +
          `"chatId" varchar NOT NULL, ` +
          `"type" varchar NOT NULL, ` +
          `"payload" text NOT NULL, ` +
          `"scheduledAt" datetime NOT NULL, ` +
          `"status" varchar NOT NULL DEFAULT ('pending'), ` +
          `"sentMessageId" varchar, ` +
          `"error" varchar, ` +
          `"sentAt" datetime, ` +
          `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `"updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `CONSTRAINT "FK_scheduled_messages_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_messages_session_status_scheduledAt" ON "scheduled_messages" ("sessionId", "status", "scheduledAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_messages_session_status_scheduledAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_messages"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledMessages1787500000000 implements MigrationInterface {
  name = 'AddScheduledMessages1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduled_messages')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "scheduled_messages" (` +
          `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
          `"session_id" varchar NOT NULL, ` +
          `"recipient" varchar NOT NULL, ` +
          `"recipient_type" varchar NOT NULL DEFAULT 'personal', ` +
          `"message_type" varchar NOT NULL, ` +
          `"status" varchar NOT NULL DEFAULT 'pending', ` +
          `"preview_text" text, ` +
          `"details" text NOT NULL, ` +
          `"recurrence" text, ` +
          `"scheduled_at" timestamp NOT NULL, ` +
          `"created_at" timestamp NOT NULL DEFAULT NOW(), ` +
          `"updated_at" timestamp NOT NULL DEFAULT NOW(), ` +
          `"sent_at" timestamp, ` +
          `"error" text` +
          `)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "scheduled_messages" (` +
          `"id" varchar PRIMARY KEY NOT NULL, ` +
          `"session_id" varchar NOT NULL, ` +
          `"recipient" varchar NOT NULL, ` +
          `"recipient_type" varchar NOT NULL DEFAULT 'personal', ` +
          `"message_type" varchar NOT NULL, ` +
          `"status" varchar NOT NULL DEFAULT 'pending', ` +
          `"preview_text" text, ` +
          `"details" text NOT NULL, ` +
          `"recurrence" text, ` +
          `"scheduled_at" datetime NOT NULL, ` +
          `"created_at" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `"updated_at" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `"sent_at" datetime, ` +
          `"error" text` +
          `)`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_messages_session_status" ON "scheduled_messages" ("session_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_messages_status_scheduled_at" ON "scheduled_messages" ("status", "scheduled_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_messages_status_scheduled_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_messages_session_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_messages"`);
  }
}

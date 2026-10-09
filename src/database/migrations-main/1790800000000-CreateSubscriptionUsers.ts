import { MigrationInterface, QueryRunner } from 'typeorm';

/** Account subscriptions for SQLite installations that run with synchronize disabled. */
export class CreateSubscriptionUsers1790800000000 implements MigrationInterface {
  name = 'CreateSubscriptionUsers1790800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "users" (
      "id" varchar PRIMARY KEY NOT NULL,
      "email" varchar(190) NOT NULL,
      "passwordHash" varchar(255) NOT NULL,
      "name" varchar(100) NOT NULL,
      "role" varchar(20) NOT NULL DEFAULT ('user'),
      "subscriptionStatus" varchar(20) NOT NULL DEFAULT ('trial'),
      "plan" varchar(20) NOT NULL DEFAULT ('starter'),
      "maxSessions" integer NOT NULL DEFAULT (1),
      "subscriptionExpiresAt" datetime,
      "isActive" boolean NOT NULL DEFAULT (1),
      "apiKeyId" varchar(100),
      "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
      "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_97672ac88f789774dd47f7c8be"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/** Dedicated auth database; never runs against Supabase's auth schema. */
export class CreateSharedAuth1790150000000 implements MigrationInterface {
  name = 'CreateSharedAuth1790150000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "api_keys" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(100) NOT NULL, "keyHash" varchar(64) NOT NULL UNIQUE,
      "keyPrefix" varchar(12) NOT NULL, "role" varchar(20) NOT NULL DEFAULT 'operator',
      "allowedIps" text, "allowedSessions" text, "supabaseUserId" varchar(100) UNIQUE,
      "isActive" boolean NOT NULL DEFAULT true, "expiresAt" timestamptz, "lastUsedAt" timestamptz,
      "usageCount" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE "users" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" varchar(190) NOT NULL UNIQUE,
      "passwordHash" varchar(255) NOT NULL, "name" varchar(100) NOT NULL,
      "role" varchar(20) NOT NULL DEFAULT 'user', "subscriptionStatus" varchar(20) NOT NULL DEFAULT 'trial',
      "plan" varchar(20) NOT NULL DEFAULT 'starter', "maxSessions" integer NOT NULL DEFAULT 1,
      "subscriptionExpiresAt" timestamptz, "isActive" boolean NOT NULL DEFAULT true,
      "apiKeyId" varchar(100), "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE "audit_logs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "action" varchar(50) NOT NULL,
      "severity" varchar(10) NOT NULL DEFAULT 'info', "apiKeyId" varchar(36), "apiKeyName" varchar(100),
      "sessionId" varchar(36), "sessionName" varchar(100), "ipAddress" varchar(45),
      "userAgent" varchar(500), "method" varchar(10), "path" varchar(500), "statusCode" integer,
      "metadata" text, "errorMessage" text, "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    // Preserve legacy dashboard credentials from existing SQLite installations.
    // The new login path uses Supabase, but the offline importer must retain
    // populated source tables so rollback and audits remain possible.
    await queryRunner.query(`CREATE TABLE "dashboard_users" (
      "id" varchar PRIMARY KEY, "username" varchar(100) NOT NULL UNIQUE,
      "passwordHash" varchar(255) NOT NULL, "role" varchar(20) NOT NULL,
      "isActive" boolean NOT NULL, "createdAt" timestamp NOT NULL,
      "updatedAt" timestamp NOT NULL
    )`);
    for (const column of ['action', 'apiKeyId', 'sessionId', 'createdAt']) {
      await queryRunner.query(`CREATE INDEX "IDX_audit_logs_${column}" ON "audit_logs" ("${column}")`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "dashboard_users"');
    await queryRunner.query('DROP TABLE "audit_logs"');
    await queryRunner.query('DROP TABLE "users"');
    await queryRunner.query('DROP TABLE "api_keys"');
  }
}

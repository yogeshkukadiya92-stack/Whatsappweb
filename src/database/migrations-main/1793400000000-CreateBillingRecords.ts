import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateBillingRecords1793400000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE TABLE IF NOT EXISTS "billing_records" ("id" varchar(100) PRIMARY KEY NOT NULL, "payload" text NOT NULL)',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS "billing_records"');
  }
}

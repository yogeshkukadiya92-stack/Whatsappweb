import { MigrationInterface, QueryRunner } from 'typeorm';

/** Repair the historical completion-media migration that preceded its base table. */
export class RepairLeadCompletionMedia1790151000000 implements MigrationInterface {
  name = 'RepairLeadCompletionMedia1790151000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('lead_flows', 'completionMedia'))) {
      await queryRunner.query('ALTER TABLE "lead_flows" ADD COLUMN "completionMedia" text');
    }
  }

  async down(): Promise<void> {
    // Keep user attachment data: the earlier migration owns this column on upgraded installs.
  }
}

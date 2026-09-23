import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores optional image/document/audio/video attachments sent after a lead flow completes. */
export class AddLeadFlowCompletionMedia1786200000000 implements MigrationInterface {
  name = 'AddLeadFlowCompletionMedia1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fresh installs create lead_flows in the later base migration. The repair migration
    // adds this column afterwards; upgraded installations may already have the table.
    if ((await queryRunner.hasTable('lead_flows')) && !(await queryRunner.hasColumn('lead_flows', 'completionMedia'))) {
      await queryRunner.query(`ALTER TABLE "lead_flows" ADD COLUMN "completionMedia" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if ((await queryRunner.hasTable('lead_flows')) && (await queryRunner.hasColumn('lead_flows', 'completionMedia'))) {
      await queryRunner.query(`ALTER TABLE "lead_flows" DROP COLUMN "completionMedia"`);
    }
  }
}

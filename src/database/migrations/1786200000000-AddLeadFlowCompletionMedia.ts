import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores optional image/document/audio/video attachments sent after a lead flow completes. */
export class AddLeadFlowCompletionMedia1786200000000 implements MigrationInterface {
  name = 'AddLeadFlowCompletionMedia1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('lead_flows');
    if (table && !table.findColumnByName('completionMedia')) {
      await queryRunner.query(`ALTER TABLE "lead_flows" ADD COLUMN "completionMedia" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('lead_flows');
    if (table && table.findColumnByName('completionMedia')) {
      await queryRunner.query(`ALTER TABLE "lead_flows" DROP COLUMN "completionMedia"`);
    }
  }
}

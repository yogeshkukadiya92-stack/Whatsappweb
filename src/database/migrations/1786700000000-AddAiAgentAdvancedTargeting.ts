import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiAgentAdvancedTargeting1786700000000 implements MigrationInterface {
  name = 'AddAiAgentAdvancedTargeting1786700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('ai_agents');
    if (!table) return;
    if (!table.findColumnByName('audience')) await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "audience" varchar(20) NOT NULL DEFAULT 'all'`);
    if (!table.findColumnByName('targetNumbers')) await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "targetNumbers" text`);
    if (!table.findColumnByName('messageTypes')) await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "messageTypes" text`);
    if (!table.findColumnByName('similarMessages')) await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "similarMessages" text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "similarMessages"`);
  }
}

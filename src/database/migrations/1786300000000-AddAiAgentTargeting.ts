import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds recipient and message-type filters for specialized AI agents. */
export class AddAiAgentTargeting1786300000000 implements MigrationInterface {
  name = 'AddAiAgentTargeting1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('ai_agents');
    if (table && !table.findColumnByName('targetNumbers')) {
      await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "targetNumbers" text`);
    }
    if (table && !table.findColumnByName('audience')) {
      await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "audience" varchar(20) NOT NULL DEFAULT 'all'`);
    }
    if (table && !table.findColumnByName('messageTypes')) {
      await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "messageTypes" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('ai_agents');
    if (table && table.findColumnByName('messageTypes')) {
      await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "messageTypes"`);
    }
    if (table && table.findColumnByName('audience')) {
      await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "audience"`);
    }
    if (table && table.findColumnByName('targetNumbers')) {
      await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "targetNumbers"`);
    }
  }
}

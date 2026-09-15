import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds recipient and message-type filters for specialized AI agents. */
export class AddAiAgentTargeting1786300000000 implements MigrationInterface {
  name = 'AddAiAgentTargeting1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "targetNumbers" text`);
    await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "audience" varchar(20) NOT NULL DEFAULT 'all'`);
    await queryRunner.query(`ALTER TABLE "ai_agents" ADD COLUMN "messageTypes" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "messageTypes"`);
    await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "audience"`);
    await queryRunner.query(`ALTER TABLE "ai_agents" DROP COLUMN "targetNumbers"`);
  }
}

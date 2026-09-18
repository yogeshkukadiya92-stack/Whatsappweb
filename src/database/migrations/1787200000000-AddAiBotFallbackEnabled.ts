import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiBotFallbackEnabled1787200000000 implements MigrationInterface {
  name = 'AddAiBotFallbackEnabled1787200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('ai_bot_configs');
    if (!table) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';
    if (!table.findColumnByName('fallbackEnabled')) {
      if (isPostgres) {
        await queryRunner.query(`ALTER TABLE "ai_bot_configs" ADD COLUMN "fallbackEnabled" boolean NOT NULL DEFAULT false`);
      } else {
        await queryRunner.query(`ALTER TABLE "ai_bot_configs" ADD COLUMN "fallbackEnabled" boolean NOT NULL DEFAULT (0)`);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('ai_bot_configs');
    if (table && table.findColumnByName('fallbackEnabled')) {
      await queryRunner.query(`ALTER TABLE "ai_bot_configs" DROP COLUMN "fallbackEnabled"`);
    }
  }
}

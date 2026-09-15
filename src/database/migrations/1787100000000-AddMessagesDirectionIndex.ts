import { MigrationInterface, QueryRunner } from 'typeorm';

/** Count directions from a small covering index instead of reading message bodies/metadata. */
export class AddMessagesDirectionIndex1787100000000 implements MigrationInterface {
  name = 'AddMessagesDirectionIndex1787100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.dataSource.options.type === 'postgres') {
      await queryRunner.query('SET LOCAL statement_timeout = 0');
    }
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_messages_direction" ON "messages" ("direction")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_messages_direction"');
  }
}

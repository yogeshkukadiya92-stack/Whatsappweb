import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionOwner1790800000000 implements MigrationInterface {
  name = 'AddSessionOwner1790800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "sessions" ADD COLUMN "ownerUserId" varchar(100)');
    await queryRunner.query('CREATE INDEX "IDX_sessions_owner_user" ON "sessions" ("ownerUserId")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_sessions_owner_user"');
    await queryRunner.query('ALTER TABLE "sessions" DROP COLUMN "ownerUserId"');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupabaseIdentityToApiKeys1789900000000 implements MigrationInterface {
  name = 'AddSupabaseIdentityToApiKeys1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "api_keys" ADD COLUMN "supabaseUserId" varchar(100)');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_api_keys_supabase_user" ON "api_keys" ("supabaseUserId")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_api_keys_supabase_user"');
    await queryRunner.query('ALTER TABLE "api_keys" DROP COLUMN "supabaseUserId"');
  }
}

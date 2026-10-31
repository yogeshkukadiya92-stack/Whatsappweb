import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep generated UUID primary keys usable on PostgreSQL as well as SQLite. */
export class RepairWorkspaceUuidDefaults1793500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (runner.connection.options.type !== 'postgres') return;
    for (const table of ['studio_connections', 'cloud_menu_connections', 'cloud_menu_receipts']) {
      await runner.query(`ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::varchar`);
    }
  }
  async down(runner: QueryRunner): Promise<void> {
    if (runner.connection.options.type !== 'postgres') return;
    for (const table of ['studio_connections', 'cloud_menu_connections', 'cloud_menu_receipts']) {
      await runner.query(`ALTER TABLE "${table}" ALTER COLUMN "id" DROP DEFAULT`);
    }
  }
}

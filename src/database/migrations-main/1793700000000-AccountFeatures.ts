import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
export class AccountFeatures1793700000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.addColumn('users', new TableColumn({ name: 'features', type: 'text', isNullable: true }));
  }
  async down(runner: QueryRunner) { await runner.dropColumn('users', 'features'); }
}

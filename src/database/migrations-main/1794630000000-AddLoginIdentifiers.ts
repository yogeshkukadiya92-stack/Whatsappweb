import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddLoginIdentifiers1794630000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, length] of [
      ['username', '100'],
      ['phone', '32'],
    ]) {
      if (!(await queryRunner.hasColumn('users', name))) {
        await queryRunner.addColumn('users', new TableColumn({ name, type: 'varchar', length, isNullable: true }));
        await queryRunner.createIndex(
          'users',
          new TableIndex({ name: `IDX_users_login_${name}`, columnNames: [name], isUnique: true }),
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['phone', 'username']) {
      await queryRunner.dropColumn('users', name);
    }
  }
}

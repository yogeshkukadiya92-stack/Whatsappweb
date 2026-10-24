import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddCloudResourceMenus1792840000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('cloud_menu_connections'))) {
      await q.createTable(
        new Table({
          name: 'cloud_menu_connections',
          foreignKeys: [
            {
              columnNames: ['sessionId'],
              referencedTableName: 'sessions',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
          columns: [
            { name: 'id', type: 'varchar', isPrimary: true },
            { name: 'sessionId', type: 'varchar' },
            { name: 'phoneNumberId', type: 'varchar' },
            { name: 'apiVersion', type: 'varchar' },
            { name: 'enabled', type: 'boolean', default: q.connection.options.type === 'postgres' ? 'false' : '0' },
            { name: 'secret', type: 'text' },
            { name: 'verifyTokenHash', type: 'varchar' },
          ],
        }),
      );
      await q.createIndex(
        'cloud_menu_connections',
        new TableIndex({ name: 'IDX_cloud_menu_session', columnNames: ['sessionId'], isUnique: true }),
      );
      await q.createIndex(
        'cloud_menu_connections',
        new TableIndex({ name: 'IDX_cloud_menu_phone', columnNames: ['phoneNumberId'], isUnique: true }),
      );
    }
    if (!(await q.hasTable('cloud_menu_receipts'))) {
      await q.createTable(
        new Table({
          name: 'cloud_menu_receipts',
          foreignKeys: [
            {
              columnNames: ['connectionId'],
              referencedTableName: 'cloud_menu_connections',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
          columns: [
            { name: 'id', type: 'varchar', isPrimary: true },
            { name: 'connectionId', type: 'varchar' },
            { name: 'messageId', type: 'varchar', length: '512' },
            { name: 'sender', type: 'varchar' },
            { name: 'status', type: 'varchar' },
            { name: 'leaseUntil', type: 'varchar' },
            { name: 'responseId', type: 'varchar', isNullable: true },
            { name: 'consumedBy', type: 'varchar', isNullable: true },
            { name: 'menu', type: 'text', isNullable: true },
          ],
        }),
      );
      await q.createIndex(
        'cloud_menu_receipts',
        new TableIndex({ name: 'IDX_cloud_menu_message', columnNames: ['connectionId', 'messageId'], isUnique: true }),
      );
      await q.createIndex(
        'cloud_menu_receipts',
        new TableIndex({ name: 'IDX_cloud_menu_connection', columnNames: ['connectionId'] }),
      );
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('cloud_menu_receipts', true);
    await q.dropTable('cloud_menu_connections', true);
  }
}

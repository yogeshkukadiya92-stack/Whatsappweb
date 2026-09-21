import { MigrationInterface, QueryRunner } from 'typeorm';
import { AddScheduledMessages1787500000000 } from './1787500000000-AddScheduledMessages';

/** An older deployment created an incompatible camelCase table before the new scheduler migration. */
export class RepairLegacyScheduledMessages1787600000000 implements MigrationInterface {
  name = 'RepairLegacyScheduledMessages1787600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scheduled_messages');
    if (!table || table.findColumnByName('scheduled_at')) return;
    if (!table.findColumnByName('scheduledAt') || !table.findColumnByName('payload')) {
      throw new Error('Unrecognized scheduled_messages schema; refusing to replace it');
    }
    const rows = await queryRunner.query('SELECT COUNT(*) AS count FROM "scheduled_messages"');
    if (Number(rows[0].count) !== 0) {
      throw new Error('Legacy scheduled_messages contains data; migrate its payloads before upgrading');
    }
    // Keep the original table rather than deleting it. The browser-only queue is imported by
    // the dashboard with idempotency keys after the repaired API becomes available.
    await queryRunner.renameTable('scheduled_messages', 'scheduled_messages_legacy_1787600000000');
    await new AddScheduledMessages1787500000000().up(queryRunner);
  }

  async down(): Promise<void> {
    // Never replace the repaired table: it may now contain scheduled messages.
  }
}

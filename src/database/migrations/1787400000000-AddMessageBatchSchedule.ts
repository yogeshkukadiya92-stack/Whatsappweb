import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageBatchSchedule1787400000000 implements MigrationInterface {
  name = 'AddMessageBatchSchedule1787400000000';
  async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('message_batches');
    if (table && !table.findColumnByName('scheduled_at')) {
      const type = q.dataSource.options.type === 'postgres' ? 'timestamp' : 'datetime';
      await q.query(`ALTER TABLE "message_batches" ADD COLUMN "scheduled_at" ${type} NULL`);
    }
  }
  async down(q: QueryRunner): Promise<void> { await q.query(`ALTER TABLE "message_batches" DROP COLUMN "scheduled_at"`); }
}

import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddBoundedAiConversations1793600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn('ai_agents', new TableColumn({ name: 'maxReplies', type: 'int', default: 0 }));
    await q.createTable(
      new Table({
        name: 'ai_conversations',
        columns: [
          { name: 'sessionId', type: 'varchar', isPrimary: true },
          { name: 'chatId', type: 'varchar', isPrimary: true },
          { name: 'agentId', type: 'varchar' },
          { name: 'replyCount', type: 'int', default: 0 },
          { name: 'busy', type: 'boolean', default: false },
          { name: 'history', type: q.connection.options.type === 'postgres' ? 'jsonb' : 'text' },
        ],
      }),
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('ai_conversations');
    await q.dropColumn('ai_agents', 'maxReplies');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/** Add the declared agent lookup index; existing rows and job state stay untouched. */
export class AddAiQueryCaptureAgentIndex1794569400000 implements MigrationInterface {
  name = 'AddAiQueryCaptureAgentIndex1794569400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('CREATE INDEX IF NOT EXISTS "IDX_ai_query_captures_agentId" ON "ai_query_captures" ("agentId")');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX IF EXISTS "IDX_ai_query_captures_agentId"');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddStudioConnections1787000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (await q.hasTable('studio_connections')) return;
    await q.query(
      'CREATE TABLE "studio_connections" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, "name" varchar(100) NOT NULL, "kind" varchar NOT NULL DEFAULT \'api\', "allowedTools" text NOT NULL DEFAULT \'[]\', "baseUrl" varchar NOT NULL, "auth" varchar NOT NULL, "headerName" varchar NOT NULL DEFAULT \'\', "enabled" boolean NOT NULL DEFAULT true, "secret" text, FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE)',
    );
    await q.query('CREATE INDEX "IDX_studio_connections_session" ON "studio_connections" ("sessionId")');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "studio_connections"');
  }
}

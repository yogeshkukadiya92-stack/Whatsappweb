import { DataSource } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { StudioExecution, StudioJob, StudioWorkflow } from './entities/studio-workflow.entity';
import { StudioWorkflowService } from './studio-workflow.service';

// Run against a disposable PostgreSQL server with STUDIO_TEST_PG_HOST set.
// SQLite cannot catch PostgreSQL's conflicting parameter-type inference.
const postgresDescribe = process.env.STUDIO_TEST_PG_HOST ? describe : describe.skip;
postgresDescribe('Studio PostgreSQL queue delivery', () => {
  let db: DataSource;
  let admin: DataSource;
  const schema = `studio_queue_test_${process.pid}`;
  beforeAll(async () => {
    const options = {
      type: 'postgres' as const,
      host: process.env.STUDIO_TEST_PG_HOST,
      port: Number(process.env.STUDIO_TEST_PG_PORT || 5432),
      username: process.env.STUDIO_TEST_PG_USER || 'postgres',
      database: process.env.STUDIO_TEST_PG_DATABASE || 'postgres',
    };
    admin = await new DataSource(options).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      ...options,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      entities: [Session, StudioWorkflow, StudioExecution, StudioJob],
      synchronize: true,
    }).initialize();
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('delivers a matched live message instead of leaving it queued', async () => {
    const session = await db.getRepository(Session).save({ name: 'queue-regression', nodeId: null });
    const studio = new StudioWorkflowService(
      db.getRepository(StudioWorkflow),
      db.getRepository(StudioExecution),
      db.getRepository(StudioJob),
    );
    await studio.save(session.id, {
      name: 'Meeting booking',
      enabled: true,
      definition: {
        keywords: ['meeting', 'મીટિંગ'],
        audience: 'direct',
        cooldownSeconds: 60,
        steps: [{ id: 'reply', type: 'reply', label: 'Booking link', config: { text: 'Book your meeting' } }],
      },
    });
    expect(await studio.inbound(session.id, 'મીટિંગ', 'test@c.us')).toBe(true);
    const send = jest.fn(() => Promise.resolve(undefined));
    await studio.processDue(send);
    expect(send).toHaveBeenCalledWith(session.id, 'test@c.us', 'Book your meeting');
    expect((await studio.logs(session.id))[0].status).toBe('success');
  });
});

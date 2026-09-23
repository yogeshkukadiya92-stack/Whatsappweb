import { DataSource } from 'typeorm';
import { mainDatabaseOptions } from './main-database-options';
import { join } from 'node:path';
import { ApiKey, ApiKeyRole } from '../modules/auth/entities/api-key.entity';
import { User } from '../modules/auth/entities/user.entity';
import { AuthService } from '../modules/auth/auth.service';

// Run only against a dedicated disposable database, never the production URL.
const testUrl = process.env.TEST_MAIN_POSTGRES_URL;
const pgTest = testUrl ? describe : describe.skip;

pgTest('shared PostgreSQL auth storage', () => {
  let source: DataSource;

  beforeAll(async () => {
    if (process.env.MAIN_DATABASE_TYPE !== 'postgres') throw new Error('Run with MAIN_DATABASE_TYPE=postgres');
    source = new DataSource(
      mainDatabaseOptions(
        {
          type: 'postgres',
          url: testUrl,
          database: '',
          synchronize: false,
          logging: false,
        },
        join(__dirname, '..'),
      ),
    );
    await source.initialize();
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
  });

  it('migrates all main entities and preserves the last admin under concurrent revocations', async () => {
    const repository = source.getRepository(ApiKey);
    const [first, second] = await repository.save([
      repository.create({ name: 'a', keyHash: 'a'.repeat(64), keyPrefix: 'a', role: ApiKeyRole.ADMIN }),
      repository.create({ name: 'b', keyHash: 'b'.repeat(64), keyPrefix: 'b', role: ApiKeyRole.ADMIN }),
    ]);
    const auth = new AuthService(
      repository,
      source.getRepository(User),
      {
        forget: () => undefined,
      } as never,
      { get: () => undefined } as never,
    );
    const results = await Promise.allSettled([auth.revoke(first.id), auth.revoke(second.id)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await repository.count({ where: { isActive: true, role: ApiKeyRole.ADMIN } })).toBe(1);
    expect(await source.getRepository(User).count()).toBe(0);
  });
});

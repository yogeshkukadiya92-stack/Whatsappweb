import { mainDatabaseOptions } from './main-database-options';

const config = { type: 'sqlite', database: '/tmp/auth.sqlite', synchronize: true, logging: false };

describe('main database connection options', () => {
  it('preserves the existing SQLite store and schema behavior by default', () => {
    expect(mainDatabaseOptions(config, '/app/dist')).toMatchObject({
      type: 'better-sqlite3',
      database: '/tmp/auth.sqlite',
      synchronize: true,
      migrationsRun: false,
    });
  });

  it('uses a separate PostgreSQL migration chain without schema synchronization', () => {
    expect(
      mainDatabaseOptions({ ...config, type: 'postgres', url: 'postgres://host/waply_auth' }, '/app/dist'),
    ).toMatchObject({
      type: 'postgres',
      url: 'postgres://host/waply_auth',
      synchronize: false,
      migrationsRun: true,
      migrations: ['/app/dist/database/migrations-main-postgres/*{.ts,.js}'],
    });
  });

  it('refuses to silently fall back to SQLite when a shared database URL is missing', () => {
    expect(() => mainDatabaseOptions({ ...config, type: 'postgres' }, '/app/dist')).toThrow('MAIN_DATABASE_URL');
  });
});

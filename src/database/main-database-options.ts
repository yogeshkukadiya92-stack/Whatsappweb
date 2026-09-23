import { DataSourceOptions } from 'typeorm';

export interface MainDatabaseConfig {
  type: string;
  url?: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
}

/** Shared by the server and migration CLI so they always address the same auth database. */
export function mainDatabaseOptions(config: MainDatabaseConfig, sourceRoot: string): DataSourceOptions {
  const common = {
    name: 'main',
    entities: [sourceRoot + '/modules/auth/**/*.entity{.ts,.js}', sourceRoot + '/modules/audit/**/*.entity{.ts,.js}'],
    logging: config.logging,
  };
  if (config.type === 'postgres') {
    if (!config.url) throw new Error('MAIN_DATABASE_URL is required for PostgreSQL auth storage');
    return {
      ...common,
      type: 'postgres',
      url: config.url,
      migrations: [sourceRoot + '/database/migrations-main-postgres/*{.ts,.js}'],
      synchronize: false,
      migrationsRun: true,
      extra: { max: 5, connectionTimeoutMillis: 10000, statement_timeout: 30000 },
    };
  }
  return {
    ...common,
    type: 'better-sqlite3',
    database: config.database,
    migrations: [sourceRoot + '/database/migrations-main/*{.ts,.js}'],
    synchronize: config.synchronize,
    migrationsRun: !config.synchronize,
  };
}

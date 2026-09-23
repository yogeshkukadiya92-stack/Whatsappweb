import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { mainDatabaseOptions } from './main-database-options';
import { loadCliEnv } from './load-cli-env';
import { sqliteDataMainPathCollision } from '../config/env.validation';

// Load environment variables with the app's precedence (mirrors data-source.ts / main.ts).
loadCliEnv();

// Same guard as data-source.ts: the TypeORM CLI never runs ConfigModule's validate(), so the
// SQLite main/data file collision check from env.validation is re-applied here — a shared broken
// env (DATABASE_NAME resolving to the main file) must refuse BOTH migration entry points, not just
// the data one.
const sqlitePathCollision = sqliteDataMainPathCollision(process.env);
if (sqlitePathCollision) {
  throw new Error(sqlitePathCollision);
}

/**
 * Standalone TypeORM CLI DataSource for the MAIN connection (auth + audit).
 *
 * Uses the same configured SQLite or PostgreSQL auth/audit connection as the server.
 * PostgreSQL has a separate migration directory; no Supabase auth tables are modified.
 * synchronize is always false here because the CLI manages schema via migrations.
 *
 * Usage: `npm run migration:run:main` (dev) / `migration:run:main:prod` (compiled).
 */
const mainDataSource = new DataSource({
  ...mainDatabaseOptions(configuration().database, __dirname + '/..'),
  synchronize: false,
  migrationsRun: false,
});

export default mainDataSource;

/** Main auth/audit entities use their own connection, independently of DATABASE_TYPE. */
export const mainDateColumnType = (): 'datetime' | 'timestamptz' =>
  process.env.MAIN_DATABASE_TYPE === 'postgres' ? 'timestamptz' : 'datetime';

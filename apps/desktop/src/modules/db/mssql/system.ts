/**
 * The databases SQL Server keeps for itself.
 *
 * `master` holds the server's own configuration, `msdb` the Agent's jobs and backup history,
 * `model` the template every new database is copied from, and `tempdb` is rebuilt at every restart.
 * None of the four is somewhere a person browsing their own data means to end up.
 *
 * `mssql::list_databases` already filters them out with `database_id > 4`, so nothing in the
 * sidebar reaches this today. It is defined anyway, and correctly — the same way PostgreSQL keeps
 * `isPostgresSystemDatabase` despite its own `list_databases` filtering first — because
 * `SqlDialect.isSystemDatabase` is asked wherever a database name arrives from somewhere else.
 */
const SYSTEM_DATABASES = new Set(["master", "tempdb", "model", "msdb"]);

/** Whether the database belongs to the server rather than to the user. Matched case-insensitively:
 *  SQL Server's default collation folds case, so `Master` names the same database. */
export function isMssqlSystemDatabase(database: string): boolean {
  return SYSTEM_DATABASES.has(database.toLowerCase());
}

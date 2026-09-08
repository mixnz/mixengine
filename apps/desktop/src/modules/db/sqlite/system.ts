/**
 * SQLite has no system database.
 *
 * A file holds one database, called `main`, and it is the user's. What MySQL and PostgreSQL keep
 * for themselves — the catalogue, the maintenance database — SQLite keeps in `sqlite_master` and
 * the other `sqlite_%` tables inside that same database, and the backend leaves those out of the
 * table list rather than offering them as something to select.
 *
 * So this always answers false, and it exists only because {@link SqlDialect} asks the question.
 */
export function isSqliteSystemDatabase(_database: string): boolean {
  return false;
}

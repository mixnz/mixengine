/** The databases MySQL keeps for itself. Dumping one of them is meaningless — the server rebuilds
 * them from its own data directory — and dropping one breaks the server, so the actions that act
 * on a whole database stay switched off while one of these is selected. */
const SYSTEM_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

/** Whether the database belongs to the server rather than to the user. Matched case-insensitively:
 * MySQL folds these names on Windows, so `MySQL` names the same database as `mysql`. */
export function isMysqlSystemDatabase(database: string): boolean {
  return SYSTEM_DATABASES.has(database.toLowerCase());
}

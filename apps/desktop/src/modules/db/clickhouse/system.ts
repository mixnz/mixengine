/**
 * ClickHouse's own databases — the ones the server keeps for itself rather than for what someone
 * connected it for.
 *
 * `system` holds the server's own metadata and query log; `information_schema` and its upper-case
 * twin are the standard views ClickHouse exposes over the same thing, kept for tools that expect
 * them. None of the three is somewhere a person browsing their own data means to end up.
 */
const SYSTEM_DATABASES = new Set(["system", "information_schema", "INFORMATION_SCHEMA"]);

export function isClickhouseSystemDatabase(database: string): boolean {
  return SYSTEM_DATABASES.has(database);
}

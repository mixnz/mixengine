import type { SqlApi } from "./sql/api";
import type { SqlDialect } from "./sql/dialect";
import { mysqlApi } from "./mysql/api";
import { mysqlDialect } from "./mysql/dialect";
import { postgresApi } from "./postgres/api";
import { postgresDialect } from "./postgres/dialect";
import { sqliteApi } from "./sqlite/api";
import { sqliteDialect } from "./sqlite/dialect";
import { clickhouseApi } from "./clickhouse/api";
import { clickhouseDialect } from "./clickhouse/dialect";
import { mssqlApi } from "./mssql/api";
import { mssqlDialect } from "./mssql/dialect";
import type { DbKind } from "./types";

/**
 * The engines the shared SQL workspace can be opened on — the one place a kind is turned into the
 * pair of things everything below the workspace works through.
 *
 * A kind that is in here is a SQL kind — {@link isSqlKind} is read off this map — so adding an
 * engine is this entry and nothing else.
 *
 * In a file of its own rather than in `DbTab`, because two things ask it questions: the tab, which
 * wants the api and dialect to hand to the workspace, and `connectionForm.ts`, which only wants to
 * know whether a kind has a TLS box at all.
 */
export const SQL_ENGINES = {
  mysql: { api: mysqlApi, dialect: mysqlDialect },
  postgres: { api: postgresApi, dialect: postgresDialect },
  sqlite: { api: sqliteApi, dialect: sqliteDialect },
  clickhouse: { api: clickhouseApi, dialect: clickhouseDialect },
  mssql: { api: mssqlApi, dialect: mssqlDialect },
} as const satisfies Partial<Record<DbKind, { api: SqlApi; dialect: SqlDialect }>>;

export type SqlKind = keyof typeof SQL_ENGINES;

/** Whether this kind opens the SQL workspace, and — to TypeScript — which of them it is. */
export function isSqlKind(kind: DbKind): kind is SqlKind {
  return kind in SQL_ENGINES;
}

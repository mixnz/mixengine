import { invoke } from "@tauri-apps/api/core";
import type {
  SqlCollation,
  SqlProblem,
  SqlSchemaOutline,
  SqlStatementResult,
  SqlTablePage,
  SqlTableStructure,
  TableStats,
} from "../types";
import type { SqlApi, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * PostgreSQL's side of {@link SqlApi}.
 *
 * `database` means something different here than it does on MySQL. There, it names a database to
 * reach into over the one connection; here it picks which pool the command runs on, since a
 * PostgreSQL connection is bound to the database it was opened on. The backend does that picking —
 * see `postgres_pool` — so from this side the two read the same.
 *
 * A table arrives as the name the sidebar shows: bare for a table of `public`, and
 * `schema.table` otherwise. That name is what the backend resolves back into a schema and a table,
 * so nothing on this side has to know about schemas at all.
 */
export const postgresApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("postgres_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("postgres_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("postgres_server_info", { id });
  },

  tableStats(id, database) {
    return invoke<TableStats[]>("postgres_table_stats", { id, database });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("postgres_table_data", { id, database, table, query });
  },

  updateRow(id, database, table, updates, key) {
    return invoke<void>("postgres_update_row", { id, database, table, updates, key });
  },

  insertRows(id, database, table, rows) {
    return invoke<void>("postgres_insert_rows", { id, database, table, rows });
  },

  deleteRows(id, database, table, keys, all, resetAutoIncrement) {
    return invoke<void>("postgres_delete_rows", {
      id,
      database,
      table,
      keys,
      all,
      resetAutoIncrement,
    });
  },

  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("postgres_table_structure", { id, database, table });
  },

  collations(id) {
    return invoke<SqlCollation[]>("postgres_collations", { id });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("postgres_schema_outline", { id, database });
  },

  runScript(id, runId, sql, database) {
    return invoke<SqlStatementResult[]>("postgres_run_script", { id, runId, sql, database });
  },

  validateSql(id, sql, database) {
    return invoke<SqlProblem | null>("postgres_validate_sql", { id, sql, database });
  },

  // No database named: `pg_cancel_backend` is a server-level function, so the cancel reaches a
  // session on any database of the same server — which is what lets it go out on whichever pool
  // is already open rather than needing the one the script is running on.
  cancelQuery(id, runId) {
    return invoke<void>("postgres_cancel_query", { id, runId });
  },

  // Changing the shape of a database or a table. `collation` is sent for both of the two that take
  // one and ignored by both: a PostgreSQL database's collation is a locale of the host rather than
  // a name from a list, and a table has none at all — only its text columns do. The dialogs do not
  // ask for it here; the parameter stays because {@link SqlApi} is one shape for both engines.
  createDatabase(id, name, collation) {
    return invoke<void>("postgres_create_database", { id, name, collation });
  },

  dropDatabase(id, database) {
    return invoke<void>("postgres_drop_database", { id, database });
  },

  createTable(id, database, table, collation, _engine) {
    return invoke<void>("postgres_create_table", { id, database, table, collation });
  },

  renameTable(id, database, table, newName) {
    return invoke<void>("postgres_rename_table", { id, database, table, newName });
  },

  dropTable(id, database, table) {
    return invoke<void>("postgres_drop_table", { id, database, table });
  },

  addColumn(id, database, table, spec) {
    return invoke<void>("postgres_add_column", { id, database, table, spec });
  },

  modifyColumn(id, database, table, name, spec) {
    return invoke<void>("postgres_modify_column", { id, database, table, name, spec });
  },

  dropColumn(id, database, table, name) {
    return invoke<void>("postgres_drop_column", { id, database, table, name });
  },

  addIndex(id, database, table, spec) {
    return invoke<void>("postgres_add_index", { id, database, table, spec });
  },

  modifyIndex(id, database, table, name, spec) {
    return invoke<void>("postgres_modify_index", { id, database, table, name, spec });
  },

  dropIndex(id, database, table, name) {
    return invoke<void>("postgres_drop_index", { id, database, table, name });
  },

  dump(id, database, mode, path) {
    return invoke<void>("postgres_dump", { id, database, mode, path });
  },

  restore(id, database, path) {
    return invoke<void>("postgres_restore", { id, database, path });
  },

  addSkipIndex: () => notSupported(),
  modifySkipIndex: () => notSupported(),
  dropSkipIndex: () => notSupported(),
  rebuildOrderBy: () => notSupported(),
  rowCount: () => notSupported(),
};

/** These five only mean anything on ClickHouse — see `clickhouseApi`. Reaching one here would be a
 *  bug in the caller: every dialog and panel that calls them is gated on
 *  `dialect.kind === "clickhouse"`. */
function notSupported(): Promise<never> {
  return Promise.reject(new Error("error.clickhouseOnlyFeature"));
}

/**
 * Runs one statement and hands back its rows, keyed by column name — the counterpart of
 * `mysqlQuery`, and outside {@link SqlApi} for the same reason.
 */
export function postgresQuery(
  id: string,
  sql: string,
  database?: string
): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>("postgres_query", { id, sql, database });
}

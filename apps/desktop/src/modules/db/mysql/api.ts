import { invoke } from "@tauri-apps/api/core";
import type {
  SqlCollation,
  SqlColumnSpec,
  SqlIndexSpec,
  SqlProblem,
  SqlSchemaOutline,
  SqlStatementResult,
  SqlTablePage,
  SqlTableStructure,
  TableStats,
} from "../types";
import type { SqlApi, SqlDumpMode, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * MySQL's side of {@link SqlApi}: one `mysql_*` command each, and nothing else.
 *
 * Every method is a straight `invoke`, so what each of them means — and what it promises about
 * ordering, privileges or atomicity — is documented once on the interface rather than again here.
 * Anything MySQL does that another engine would not is the backend's business, not this file's.
 */
export const mysqlApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("mysql_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("mysql_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("mysql_server_info", { id });
  },

  tableStats(id, database) {
    return invoke<TableStats[]>("mysql_table_stats", { id, database });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("mysql_table_data", { id, database, table, query });
  },

  updateRow(id, database, table, updates, key) {
    return invoke<void>("mysql_update_row", { id, database, table, updates, key });
  },

  insertRows(id, database, table, rows) {
    return invoke<void>("mysql_insert_rows", { id, database, table, rows });
  },

  deleteRows(id, database, table, keys, all, resetAutoIncrement) {
    return invoke<void>("mysql_delete_rows", {
      id,
      database,
      table,
      keys,
      all,
      resetAutoIncrement,
    });
  },

  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("mysql_table_structure", { id, database, table });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("mysql_schema_outline", { id, database });
  },

  collations(id) {
    return invoke<SqlCollation[]>("mysql_collations", { id });
  },

  dump(id, database, mode: SqlDumpMode, path) {
    return invoke<void>("mysql_dump", { id, database, mode, path });
  },

  restore(id, database, path) {
    return invoke<void>("mysql_restore", { id, database, path });
  },

  dropDatabase(id, database) {
    return invoke<void>("mysql_drop_database", { id, database });
  },

  createDatabase(id, name, collation) {
    return invoke<void>("mysql_create_database", { id, name, collation });
  },

  createTable(id, database, table, collation, _engine) {
    return invoke<void>("mysql_create_table", { id, database, table, collation });
  },

  renameTable(id, database, table, newName) {
    return invoke<void>("mysql_rename_table", { id, database, table, newName });
  },

  dropTable(id, database, table) {
    return invoke<void>("mysql_drop_table", { id, database, table });
  },

  addColumn(id, database, table, spec: SqlColumnSpec) {
    return invoke<void>("mysql_add_column", { id, database, table, spec });
  },

  modifyColumn(id, database, table, name, spec: SqlColumnSpec) {
    return invoke<void>("mysql_modify_column", { id, database, table, name, spec });
  },

  dropColumn(id, database, table, name) {
    return invoke<void>("mysql_drop_column", { id, database, table, name });
  },

  addIndex(id, database, table, spec: SqlIndexSpec) {
    return invoke<void>("mysql_add_index", { id, database, table, spec });
  },

  modifyIndex(id, database, table, name, spec: SqlIndexSpec) {
    return invoke<void>("mysql_modify_index", { id, database, table, name, spec });
  },

  dropIndex(id, database, table, name) {
    return invoke<void>("mysql_drop_index", { id, database, table, name });
  },

  runScript(id, runId, sql, database) {
    return invoke<SqlStatementResult[]>("mysql_run_script", { id, runId, sql, database });
  },

  cancelQuery(id, runId) {
    return invoke<void>("mysql_cancel_query", { id, runId });
  },

  validateSql(id, sql, database) {
    return invoke<SqlProblem | null>("mysql_validate_sql", { id, sql, database });
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
 * Runs one statement and hands back its rows, keyed by column name.
 *
 * Outside {@link SqlApi} because nothing in the workspace goes through it: the Query tab runs
 * scripts, and a script reports far more about each statement than its rows. Kept as the one-shot
 * way in, for a caller that wants a single answer and can assume the column names are distinct.
 */
export function mysqlQuery(
  id: string,
  sql: string,
  database?: string
): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>("mysql_query", { id, sql, database });
}

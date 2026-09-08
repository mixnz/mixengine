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
import type { SqlApi, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * SQL Server's side of {@link SqlApi} — reading is done, and so are the three row-write methods.
 *
 * `database` means what it means on MySQL rather than on PostgreSQL: a database to reach into over
 * the one connection, not a pool to pick. See `mssql_pool` in the backend.
 *
 * DDL is done too (Plan 6) — creating, renaming and dropping databases/tables/columns/indexes.
 * Dump and restore are done as well (Plan 7), the driver's own — no external tool, see
 * `docs/superpowers/specs/2026-09-05-mssql-support-design.md`'s D10. The five methods still
 * rejecting below are not on their way in a later plan — they are ClickHouse-only, the same as on
 * `postgresApi`/`mysqlApi`/`sqliteApi`, and SQL Server never gets them.
 */
export const mssqlApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("mssql_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("mssql_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("mssql_server_info", { id });
  },

  tableStats(id, database) {
    return invoke<TableStats[]>("mssql_table_stats", { id, database });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("mssql_table_data", { id, database, table, query });
  },

  updateRow(id, database, table, updates, key) {
    return invoke<void>("mssql_update_row", { id, database, table, updates, key });
  },

  insertRows(id, database, table, rows) {
    return invoke<void>("mssql_insert_rows", { id, database, table, rows });
  },

  deleteRows(id, database, table, keys, all, resetAutoIncrement) {
    return invoke<void>("mssql_delete_rows", {
      id,
      database,
      table,
      keys,
      all,
      resetAutoIncrement,
    });
  },

  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("mssql_table_structure", { id, database, table });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("mssql_schema_outline", { id, database });
  },

  collations(id) {
    return invoke<SqlCollation[]>("mssql_collations", { id });
  },

  dump(id, database, mode, path) {
    return invoke<void>("mssql_dump", { id, database, mode, path });
  },

  restore(id, database, path) {
    return invoke<void>("mssql_restore", { id, database, path });
  },

  dropDatabase(id, database) {
    return invoke<void>("mssql_drop_database", { id, database });
  },

  createDatabase(id, name, collation) {
    return invoke<void>("mssql_create_database", { id, name, collation });
  },

  createTable(id, database, table, collation, engine) {
    return invoke<void>("mssql_create_table", { id, database, table, collation, engine });
  },

  renameTable(id, database, table, newName) {
    return invoke<void>("mssql_rename_table", { id, database, table, newName });
  },

  dropTable(id, database, table) {
    return invoke<void>("mssql_drop_table", { id, database, table });
  },

  addColumn(id, database, table, spec: SqlColumnSpec) {
    return invoke<void>("mssql_add_column", { id, database, table, spec });
  },

  modifyColumn(id, database, table, name, spec: SqlColumnSpec) {
    return invoke<void>("mssql_modify_column", { id, database, table, name, spec });
  },

  dropColumn(id, database, table, name) {
    return invoke<void>("mssql_drop_column", { id, database, table, name });
  },

  addIndex(id, database, table, spec: SqlIndexSpec) {
    return invoke<void>("mssql_add_index", { id, database, table, spec });
  },

  modifyIndex(id, database, table, name, spec: SqlIndexSpec) {
    return invoke<void>("mssql_modify_index", { id, database, table, name, spec });
  },

  dropIndex(id, database, table, name) {
    return invoke<void>("mssql_drop_index", { id, database, table, name });
  },

  addSkipIndex: () => notSupported(),
  modifySkipIndex: () => notSupported(),
  dropSkipIndex: () => notSupported(),
  rebuildOrderBy: () => notSupported(),
  rowCount: () => notSupported(),
  runScript(id, runId, sql, database) {
    return invoke<SqlStatementResult[]>("mssql_run_script", { id, runId, sql, database });
  },

  cancelQuery(id, runId) {
    return invoke<void>("mssql_cancel_query", { id, runId });
  },

  validateSql(id, sql, database) {
    return invoke<SqlProblem | null>("mssql_validate_sql", { id, sql, database });
  },
};

/** These five only mean anything on ClickHouse — see `clickhouseApi`. Reaching one here would be a
 *  bug in the caller: every dialog and panel that calls them is gated on
 *  `dialect.kind === "clickhouse"`. */
function notSupported(): Promise<never> {
  return Promise.reject(new Error("error.clickhouseOnlyFeature"));
}

import { invoke } from "@tauri-apps/api/core";
import type {
  SqlProblem,
  SqlSchemaOutline,
  SqlStatementResult,
  SqlTablePage,
  SqlTableStructure,
  TableStats,
} from "../types";
import type { SqlApi, SqlDumpMode, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * ClickHouse's side of {@link SqlApi}. Row writes and DDL both call real commands — see
 * `docs/superpowers/specs/2026-09-04-clickhouse-row-writes-design.md` and
 * `docs/superpowers/specs/2026-09-04-clickhouse-ddl-design.md`.
 *
 * What is left as `notSupported()` is the three index methods: no Tauri command exists for any of
 * them, and none is ever registered — a call here fails as a rejected promise carrying
 * `error.clickhouseReadOnly` rather than as "command not found". `editing.indexKinds` being empty
 * keeps the index dialog from offering a path to them. Dump and restore are real commands now — see
 * `docs/superpowers/specs/2026-09-04-clickhouse-dump-restore-design.md`.
 */
export const clickhouseApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("clickhouse_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("clickhouse_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("clickhouse_server_info", { id });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("clickhouse_table_data", { id, database, table, query });
  },

  tableStats(id, database) {
    return invoke<TableStats[]>("clickhouse_table_stats", { id, database });
  },

  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("clickhouse_table_structure", { id, database, table });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("clickhouse_schema_outline", { id, database });
  },

  collations() {
    // No per-database/table/column collation to list — see `clickhouseDialect`'s and `SqlApi`'s
    // own docs on `collations`. Not a rejection: an empty list is the honest answer, not a refusal.
    return Promise.resolve([]);
  },

  runScript(id, runId, sql, database) {
    return invoke<SqlStatementResult[]>("clickhouse_run_script", { id, runId, sql, database });
  },

  validateSql(id, sql, database) {
    return invoke<SqlProblem | null>("clickhouse_validate_sql", { id, sql, database });
  },

  cancelQuery() {
    /* Not `notSupported`: there will never be a command here in v1. The button that would call
       this is closed by `cancellable: false` on the dialect, and this exists only to satisfy the
       interface — the same posture `sqliteApi.cancelQuery` takes, for a different reason. */
    return Promise.resolve();
  },

  updateRow(id, database, table, updates, key) {
    return invoke<void>("clickhouse_update_row", { id, database, table, updates, key });
  },

  insertRows(id, database, table, rows) {
    return invoke<void>("clickhouse_insert_rows", { id, database, table, rows });
  },

  createDatabase(id, name, collation) {
    // `collation` goes across and is dropped there: ClickHouse has none, and this signature is
    // shared by four engines.
    return invoke<void>("clickhouse_create_database", { id, name, collation });
  },

  dropDatabase(id, database) {
    return invoke<void>("clickhouse_drop_database", { id, database });
  },

  createTable(id, database, table, _collation, engine) {
    return invoke<void>("clickhouse_create_table", { id, database, table, engine });
  },

  renameTable(id, database, table, newName) {
    return invoke<void>("clickhouse_rename_table", { id, database, table, newName });
  },

  dropTable(id, database, table) {
    return invoke<void>("clickhouse_drop_table", { id, database, table });
  },

  addColumn(id, database, table, spec) {
    return invoke<void>("clickhouse_add_column", { id, database, table, spec });
  },

  modifyColumn(id, database, table, name, spec) {
    return invoke<void>("clickhouse_modify_column", { id, database, table, name, spec });
  },

  dropColumn(id, database, table, name) {
    return invoke<void>("clickhouse_drop_column", { id, database, table, name });
  },

  deleteRows(id, database, table, keys, all, resetAutoIncrement) {
    return invoke<void>("clickhouse_delete_rows", {
      id,
      database,
      table,
      keys,
      all,
      resetAutoIncrement,
    });
  },

  addSkipIndex(id, database, table, spec) {
    return invoke<void>("clickhouse_add_skip_index", { id, database, table, spec });
  },

  modifySkipIndex(id, database, table, name, spec) {
    return invoke<void>("clickhouse_modify_skip_index", { id, database, table, name, spec });
  },

  dropSkipIndex(id, database, table, name) {
    return invoke<void>("clickhouse_drop_skip_index", { id, database, table, name });
  },

  rebuildOrderBy(id, database, table, columns) {
    return invoke<string | null>("clickhouse_rebuild_order_by", { id, database, table, columns });
  },

  rowCount(id, database, table) {
    return invoke<number>("clickhouse_row_count", { id, database, table });
  },

  dump(id, database, mode: SqlDumpMode, path) {
    return invoke<void>("clickhouse_dump", { id, database, mode, path });
  },

  restore(id, database, path) {
    return invoke<void>("clickhouse_restore", { id, database, path });
  },

  addIndex: () => notSupported(),
  modifyIndex: () => notSupported(),
  dropIndex: () => notSupported(),
};

/** What the five methods above report: no command is invoked, so none fails as "command not
 *  found". */
function notSupported(): Promise<never> {
  return Promise.reject(new Error("error.clickhouseReadOnly"));
}

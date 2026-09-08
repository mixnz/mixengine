import type { SqlDialect } from "../sql/dialect";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { CLICKHOUSE_SYNTAX } from "../sql/syntax";
import { StandardSQL } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isClickhouseSystemDatabase } from "./system";
import { clickhouseEditing } from "./editing";

/**
 * ClickHouse's side of {@link SqlDialect}. v1 was read-only throughout — see
 * `docs/superpowers/plans/2026-09-04-clickhouse-db-kind.md`. The Data tab's grid can now write rows
 * and the Query tab now takes `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` by hand (both `rowsWritable`),
 * DDL writes (`ddlWritable`) and dump/restore (`dumpRestoreWritable`) are both open too — see
 * `docs/superpowers/specs/2026-09-04-clickhouse-row-writes-design.md`,
 * `docs/superpowers/specs/2026-09-04-clickhouse-query-dml-design.md`,
 * `docs/superpowers/specs/2026-09-04-clickhouse-ddl-design.md` and
 * `docs/superpowers/specs/2026-09-04-clickhouse-dump-restore-design.md` — only Query-tab DDL
 * (`writable`) is still closed.
 *
 * `cmDialect` is `StandardSQL` rather than a ClickHouse dialect of its own: `@codemirror/lang-sql`
 * ships MySQL, MariaSQL, PostgreSQL, SQLite, MSSQL, Cassandra and PLSQL, and none of them is
 * ClickHouse. `StandardSQL` is the neutral one of the seven — ClickHouse-specific words (`FORMAT`,
 * `ARRAY JOIN`, `GLOBAL IN`, …) simply do not highlight as keywords, which costs the editor some
 * colour and none of its ability to parse or run what is typed.
 */
export const clickhouseDialect: SqlDialect = {
  kind: "clickhouse",
  syntax: CLICKHOUSE_SYNTAX,
  cmDialect: StandardSQL,
  reserved: reservedWords(StandardSQL),
  editing: clickhouseEditing,
  isSystemDatabase: isClickhouseSystemDatabase,
  isAutoIncrement,
  isGenerated,
  isServerAssigned,
  isBinary,
  // ClickHouse does have a way to stop a running statement (`KILL QUERY`), but reaching it needs a
  // `query_id` tracked per request, which nothing here does yet — closed rather than wired to a
  // button that would do nothing.
  cancellable: false,
  // The Query tab's own DDL/miscellaneous writes are still closed — see `SqlDialect.writable`. Its
  // four DML verbs are open through `rowsWritable` instead, see
  // `docs/superpowers/specs/2026-09-04-clickhouse-query-dml-design.md`.
  writable: false,
  // Dump/restore is open — see `docs/superpowers/specs/2026-09-04-clickhouse-dump-restore-design.md`.
  dumpRestoreWritable: true,
  // The Structure tab writes: create/rename/drop table, create/drop database, and columns — see
  // `docs/superpowers/specs/2026-09-04-clickhouse-ddl-design.md`.
  ddlWritable: true,
  // The Data tab's grid can insert, update and delete rows, and the Query tab can send
  // INSERT/UPDATE/DELETE/TRUNCATE by hand — see
  // `docs/superpowers/specs/2026-09-04-clickhouse-row-writes-design.md` and
  // `docs/superpowers/specs/2026-09-04-clickhouse-query-dml-design.md`.
  rowsWritable: true,
  // ClickHouse has no `REGEXP` operator; a match is the function `match(column, pattern)`, which
  // the filter bar has no way to offer through an operator dropdown yet.
  regexpFilter: false,
};

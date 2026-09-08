import type { SqlDialect } from "../sql/dialect";
import { MSSQL_SYNTAX } from "../sql/syntax";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { MSSQL } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isMssqlSystemDatabase } from "./system";
import { mssqlEditing } from "./editing";

/**
 * SQL Server's side of {@link SqlDialect}. Rows can be read and written — data, structure,
 * statistics, and the Data tab's edit/add/delete — the Query tab runs a hand-typed script, multi-batch
 * `GO` scripts included, with Cancel and syntax checking as you type — the Structure tab writes
 * too: database/table/column/index create, change and drop — and a database can be dumped to a
 * `.sql` file and restored back. Every write flag is `true`. See
 * `docs/superpowers/specs/2026-09-05-mssql-support-design.md`.
 */
export const mssqlDialect: SqlDialect = {
  kind: "mssql",
  syntax: MSSQL_SYNTAX,
  cmDialect: MSSQL,
  reserved: reservedWords(MSSQL),
  editing: mssqlEditing,
  isSystemDatabase: isMssqlSystemDatabase,
  isAutoIncrement,
  isGenerated,
  isServerAssigned,
  isBinary,
  // `KILL <spid>` is the only cancel this engine has (D8) — heavier than MySQL's `KILL QUERY` or
  // PostgreSQL's `pg_cancel_backend`, since it ends the whole session, not just the statement in
  // flight. Left open rather than gated on an untested `ALTER ANY CONNECTION` permission probe —
  // see `mssql_script::cancel`'s doc comment for why, and for the error numbers it swallows on its
  // own when the session it is asked to stop is already gone.
  cancellable: true,
  writable: true,
  dumpRestoreWritable: true,
  ddlWritable: true,
  rowsWritable: true,
  // SQL Server has no regex operator before its 2025 release, so the dropdown does not offer one —
  // and `build_where` in `drivers/mssql.rs` has no arm for it either. See D12.
  regexpFilter: false,
};

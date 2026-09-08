import type { SqlDialect } from "../sql/dialect";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { SQLITE_SYNTAX } from "../sql/syntax";
import { SQLite } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isSqliteSystemDatabase } from "./system";
import { sqliteEditing } from "./editing";

/** SQLite's side of {@link SqlDialect}. The answers themselves live next door, in the files that
 *  explain what SQLite means by them — this only gathers them under the shared names. */
export const sqliteDialect: SqlDialect = {
  kind: "sqlite",
  syntax: SQLITE_SYNTAX,
  cmDialect: SQLite,
  reserved: reservedWords(SQLite),
  editing: sqliteEditing,
  isSystemDatabase: isSqliteSystemDatabase,
  isAutoIncrement,
  isGenerated,
  isServerAssigned,
  isBinary,
  // No session to reach in and kill, and no `REGEXP` in the engine — see the two fields' own docs.
  cancellable: false,
  writable: true,
  dumpRestoreWritable: true,
  ddlWritable: true,
  rowsWritable: true,
  regexpFilter: false,
};

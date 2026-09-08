import type { SqlDialect } from "../sql/dialect";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { POSTGRES_SYNTAX } from "../sql/syntax";
import { PostgreSQL } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isPostgresSystemDatabase } from "./system";
import { postgresEditing } from "./editing";

/** PostgreSQL's side of {@link SqlDialect}. */
export const postgresDialect: SqlDialect = {
  kind: "postgres",
  syntax: POSTGRES_SYNTAX,
  cmDialect: PostgreSQL,
  reserved: reservedWords(PostgreSQL),
  editing: postgresEditing,
  isSystemDatabase: isPostgresSystemDatabase,
  isAutoIncrement,
  isGenerated,
  isServerAssigned,
  isBinary,
  cancellable: true,
  writable: true,
  dumpRestoreWritable: true,
  ddlWritable: true,
  rowsWritable: true,
  regexpFilter: true,
};

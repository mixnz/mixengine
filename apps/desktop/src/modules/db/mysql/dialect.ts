import type { SqlDialect } from "../sql/dialect";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { MYSQL_SYNTAX } from "../sql/syntax";
import { MySQL } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isMysqlSystemDatabase } from "./system";
import { mysqlEditing } from "./editing";

/** MySQL's side of {@link SqlDialect}. The answers themselves live next door, in the files that
 *  explain what MySQL means by them — this only gathers them under the shared names. */
export const mysqlDialect: SqlDialect = {
  kind: "mysql",
  syntax: MYSQL_SYNTAX,
  cmDialect: MySQL,
  reserved: reservedWords(MySQL),
  editing: mysqlEditing,
  isSystemDatabase: isMysqlSystemDatabase,
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

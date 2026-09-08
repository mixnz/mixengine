import type { SqlEditing, SqlTypeSpec } from "../sql/dialect";

/**
 * The types a SQLite column can be declared as.
 *
 * Shorter than either other engine's list, and for a reason that has no counterpart there: SQLite
 * does not have types, it has *affinities*. A column declared `VARCHAR(255)` will hold a 4 KB
 * string and an integer alike; the declared type only decides which affinity SQLite applies when it
 * converts a value on the way in.
 *
 * So the five names below are the whole vocabulary that means anything — the five affinities —
 * with the familiar spellings after them for a schema written to be read by something else, or
 * copied from a MySQL one. A type not on the list is still editable: the dialog puts an unknown
 * type at the front of its own options.
 */
const TYPES: SqlTypeSpec[] = [
  { name: "INTEGER", arg: null },
  { name: "TEXT", arg: null },
  { name: "REAL", arg: null },
  { name: "BLOB", arg: null },
  { name: "NUMERIC", arg: null },
  { name: "VARCHAR", arg: "255", required: true },
  { name: "BOOLEAN", arg: null },
  { name: "DATE", arg: null },
  { name: "DATETIME", arg: null },
  { name: "DECIMAL", arg: "10,2" },
];

/**
 * What the Structure tab's dialogs offer on SQLite.
 *
 * Everything that is off is off because the statement to express it does not exist. `UNSIGNED` is
 * not a SQLite word; a column cannot be moved, since `ALTER TABLE` only appends; there is no
 * `ON UPDATE CURRENT_TIMESTAMP`; and a collation belongs to a column here, never to a table or a
 * database — the three built-in ones are `BINARY`, `NOCASE` and `RTRIM`.
 *
 * `indexMethods` is empty rather than holding `BTREE`: every SQLite index is a b-tree, so offering
 * the choice would be offering one option. And `indexKinds` leaves out `primary`, which is the one
 * that matters most: a primary key in SQLite is part of `CREATE TABLE` and cannot be added to a
 * table afterwards by any statement — see D4 of the plan this was built from.
 */
export const sqliteEditing: SqlEditing = {
  columnTypes: TYPES,
  unsigned: false,
  columnPosition: false,
  onUpdateCurrentTimestamp: false,
  autoIncrement: true,
  databaseCollation: false,
  tableCollation: false,
  /* SQLite reports a default exactly as it was written in the DDL, so `CURRENT_TIMESTAMP` and the
     string `'CURRENT_TIMESTAMP'` arrive different — quoted and unquoted — and the mark tells them
     apart the way it does on MySQL. */
  markExpressionDefaults: true,
  indexKinds: ["index", "unique"],
  indexMethods: [],
  indexPrefix: false,
  primaryKeyName: null,
};

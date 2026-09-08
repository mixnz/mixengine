import type { SqlEditing, SqlTypeSpec } from "../sql/dialect";

/**
 * The types a ClickHouse column can be declared as through the dialog.
 *
 * Exactly the whitelist the grid knows how to decode, and no wider: a column that is already an
 * `Array`/`Map`/`Tuple` can still be edited — the dialog puts a type its list has no entry for at
 * the front of its own options — but none can be created from here, because the data grid has no
 * way to show or write one back yet.
 *
 * No entry wraps `Nullable(...)`: nullability is a checkbox of its own, and it wraps around the
 * chosen type when the column is saved. See `ColumnDialog`'s `wrapNullable`.
 */
const TYPES: SqlTypeSpec[] = [
  { name: "UInt8", arg: null },
  { name: "UInt16", arg: null },
  { name: "UInt32", arg: null },
  { name: "UInt64", arg: null },
  { name: "Int8", arg: null },
  { name: "Int16", arg: null },
  { name: "Int32", arg: null },
  { name: "Int64", arg: null },
  { name: "Float32", arg: null },
  { name: "Float64", arg: null },
  { name: "Decimal", arg: "10, 2", required: true },
  { name: "String", arg: null },
  { name: "FixedString", arg: "16", required: true },
  { name: "Date", arg: null },
  { name: "Date32", arg: null },
  { name: "DateTime", arg: null },
  { name: "DateTime64", arg: "3" },
  { name: "UUID", arg: null },
  { name: "Bool", arg: null },
  { name: "Enum8", arg: "'a' = 1, 'b' = 2", required: true, list: true },
  { name: "Enum16", arg: "'a' = 1, 'b' = 2", required: true, list: true },
];

/**
 * What the Structure tab's dialogs offer on ClickHouse — see
 * `docs/superpowers/specs/2026-09-04-clickhouse-ddl-design.md`.
 *
 * Most of it is `false`, and each one is a clause ClickHouse has not got: no `UNSIGNED` (the type
 * carries its own sign), no position to put a column in (`MODIFY COLUMN` cannot move one, so
 * `ADD COLUMN ... AFTER` alone would be half a feature), no `ON UPDATE CURRENT_TIMESTAMP`, no
 * collation, and nothing that numbers a column by itself. `indexKinds` is still empty: data
 * skipping indexes are a design of their own and not built yet.
 */
export const clickhouseEditing: SqlEditing = {
  columnTypes: TYPES,
  unsigned: false,
  columnPosition: false,
  onUpdateCurrentTimestamp: false,
  autoIncrement: false,
  databaseCollation: false,
  tableCollation: false,
  // `system.columns.default_expression` writes a literal with quotes and an expression without, so
  // the two can be told apart — checked against the test server, and the same distinction MySQL
  // makes. See `clickhouse_ddl::read_default`.
  markExpressionDefaults: true,
  indexKinds: [],
  indexMethods: [],
  indexPrefix: false,
  primaryKeyName: null,
};

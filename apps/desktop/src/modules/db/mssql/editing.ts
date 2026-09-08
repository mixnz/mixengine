import type { SqlEditing, SqlTypeSpec } from "../sql/dialect";

/**
 * The types a SQL Server column can be declared as, spelled the way `display_type` in
 * `drivers/mssql.rs` writes them — a type in this list under a different spelling would leave the
 * picker looking empty on a column that has one.
 *
 * A type the list does not carry is still editable: the dialog puts an unknown type at the front of
 * its own options.
 */
const TYPES: SqlTypeSpec[] = [
  { name: "int", arg: null },
  { name: "bigint", arg: null },
  { name: "smallint", arg: null },
  { name: "tinyint", arg: null },
  { name: "bit", arg: null },
  { name: "decimal", arg: "10,2" },
  { name: "numeric", arg: "10,2" },
  { name: "money", arg: null },
  { name: "float", arg: null },
  { name: "real", arg: null },
  { name: "nvarchar", arg: "255", required: true },
  { name: "varchar", arg: "255", required: true },
  { name: "nchar", arg: "36", required: true },
  { name: "char", arg: "36", required: true },
  { name: "date", arg: null },
  { name: "time", arg: "" },
  { name: "datetime2", arg: "" },
  { name: "datetimeoffset", arg: "" },
  { name: "datetime", arg: null },
  { name: "smalldatetime", arg: null },
  { name: "uniqueidentifier", arg: null },
  { name: "varbinary", arg: "max", required: true },
  { name: "binary", arg: "8", required: true },
  { name: "xml", arg: null },
];

/**
 * What the Structure tab's dialogs offer on SQL Server.
 *
 * SQL Server sits between the two answers `databaseCollation`/`tableCollation` split apart (D14): a
 * database carries a collation and a table does not, so `databaseCollation: true` opens the box
 * `DatabaseDialog` offers and `tableCollation: false` keeps `TableDialog` from offering one
 * `create_table` would have nowhere to put.
 */
export const mssqlEditing: SqlEditing = {
  columnTypes: TYPES,
  unsigned: false,
  columnPosition: false,
  onUpdateCurrentTimestamp: false,
  autoIncrement: true,
  databaseCollation: true,
  tableCollation: false,
  markExpressionDefaults: true,
  indexKinds: ["index", "unique", "primary"],
  indexMethods: ["CLUSTERED", "NONCLUSTERED"],
  indexPrefix: false,
  primaryKeyName: null,
};

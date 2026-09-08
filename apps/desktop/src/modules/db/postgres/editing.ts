import type { SqlEditing, SqlTypeSpec } from "../sql/dialect";

/**
 * The types a PostgreSQL column can be declared as.
 *
 * Written the way PostgreSQL itself writes them, because that is what the dialog is filled from:
 * `format_type` reports a column as `character varying(255)`, not `varchar(255)`, and a type in the
 * list under a different spelling would leave the picker looking empty on a column that has one.
 *
 * A type the list does not carry is still editable — the dialog puts an unknown type at the front
 * of its own options — so this is the reachable set, not the allowed one.
 */
const TYPES: SqlTypeSpec[] = [
  { name: "integer", arg: null },
  { name: "bigint", arg: null },
  { name: "smallint", arg: null },
  { name: "numeric", arg: "10,2" },
  { name: "real", arg: null },
  { name: "double precision", arg: null },
  { name: "boolean", arg: null },
  { name: "text", arg: null },
  { name: "character varying", arg: "255" },
  { name: "character", arg: "36" },
  { name: "uuid", arg: null },
  { name: "json", arg: null },
  { name: "jsonb", arg: null },
  { name: "date", arg: null },
  { name: "timestamp without time zone", arg: "" },
  { name: "timestamp with time zone", arg: "" },
  { name: "time without time zone", arg: "" },
  { name: "time with time zone", arg: "" },
  { name: "interval", arg: null },
  { name: "bytea", arg: null },
  { name: "inet", arg: null },
  { name: "cidr", arg: null },
  { name: "macaddr", arg: null },
  { name: "money", arg: null },
  { name: "bit", arg: "1" },
  { name: "bit varying", arg: "8" },
  { name: "tsvector", arg: null },
  { name: "xml", arg: null },
  { name: "point", arg: null },
  { name: "line", arg: null },
  { name: "polygon", arg: null },
  { name: "circle", arg: null },
  { name: "int4range", arg: null },
  { name: "int8range", arg: null },
  { name: "numrange", arg: null },
  { name: "daterange", arg: null },
  { name: "tstzrange", arg: null },
  { name: "text[]", arg: null },
  { name: "integer[]", arg: null },
];

/**
 * What the Structure tab's dialogs offer on PostgreSQL.
 *
 * Four of MySQL's controls are gone rather than disabled. `UNSIGNED` does not exist; a column
 * cannot be put anywhere in particular, since PostgreSQL appends and has no statement that moves
 * one; `ON UPDATE CURRENT_TIMESTAMP` is a trigger here rather than a property of a column; and
 * neither a database nor a table carries a collation of its own (`databaseCollation`/
 * `tableCollation` both `false`) — only its text columns do.
 *
 * What PostgreSQL has more of is access methods: `gin` for a `jsonb` or a `tsvector` column and
 * `brin` for a large table ordered by its key are both worth reaching for, and neither has a MySQL
 * counterpart. They are index *methods* here rather than index kinds, which is why the two kinds
 * MySQL adds instead — `fulltext` and `spatial` — are not on this list.
 */
export const postgresEditing: SqlEditing = {
  columnTypes: TYPES,
  unsigned: false,
  columnPosition: false,
  onUpdateCurrentTimestamp: false,
  autoIncrement: true,
  databaseCollation: false,
  tableCollation: false,
  markExpressionDefaults: false,
  indexKinds: ["index", "unique", "primary"],
  indexMethods: ["BTREE", "HASH", "GIN", "GIST", "SPGIST", "BRIN"],
  indexPrefix: false,
  primaryKeyName: null,
};

/**
 * The one thing the column dialog must never get wrong: a column opened and saved without being
 * touched has to reach the server declared exactly as the server declared it.
 *
 * On PostgreSQL that is not merely tidiness. `postgres_ddl::modify_column` writes an
 * `ALTER COLUMN ... TYPE` only where the type it is given differs from the one the catalogue
 * reports, and that statement rewrites every row of the table under an ACCESS EXCLUSIVE lock. A
 * spelling that differs by a space is a full rewrite for a saved comment.
 */

import { describe, expect, it } from "vitest";
import { composeType, isIdentityLocked, parseType, unwrapNullable, wrapNullable } from "./ColumnDialog";
import { mysqlEditing } from "../../mysql/editing";
import { postgresEditing } from "../../postgres/editing";
import { clickhouseEditing } from "../../clickhouse/editing";
import type { SqlTypeSpec } from "../../sql/dialect";
import type { SqlStructureColumn } from "../../types";

/** Opens a declared type in the dialog and saves it again without touching anything. */
function roundTrip(types: readonly SqlTypeSpec[], dataType: string): string {
  const parts = parseType(types, dataType);
  // The rest of the draft is what the other fields hold; only these four decide the type.
  return composeType(types, { ...parts } as Parameters<typeof composeType>[1]);
}

describe("PostgreSQL types survive being opened and saved", () => {
  const pg = (dataType: string) => roundTrip(postgresEditing.columnTypes, dataType);

  it.each([
    "integer",
    "bigint",
    "boolean",
    "text",
    "character varying(255)",
    "character(36)",
    "numeric(10,2)",
    "double precision",
    "timestamp without time zone",
    "timestamp with time zone",
    "time with time zone",
    "jsonb",
    "uuid",
  ])("%s", (dataType) => {
    expect(pg(dataType)).toBe(dataType);
  });

  /** The names whose type is written around the modifier rather than after it. The dialog has no
   *  entry for a bare `timestamp`, so it keeps the tail verbatim — which is what makes this work. */
  it.each(["timestamp(3) without time zone", "time(3) with time zone"])("%s", (dataType) => {
    expect(pg(dataType)).toBe(dataType);
  });

  /** `format_type` writes no space before the brackets, and neither may this: PostgreSQL accepts
   *  `character varying(255) []` but the catalogue never reports it that way, so saving one would
   *  read as a change of type. */
  it.each(["text[]", "integer[]", "character varying(255)[]", "numeric(10,2)[]"])(
    "%s",
    (dataType) => {
      expect(pg(dataType)).toBe(dataType);
    }
  );
});

describe("MySQL types survive being opened and saved", () => {
  const mysql = (dataType: string) => roundTrip(mysqlEditing.columnTypes, dataType);

  it.each([
    "int",
    "int unsigned",
    "bigint(20) unsigned",
    "tinyint(1)",
    "decimal(10,2)",
    "varchar(255)",
    "text",
    "datetime",
    "json",
    "geometry",
  ])("%s", (dataType) => {
    expect(mysql(dataType)).toBe(dataType);
  });

  /** A bracket inside an `enum` is part of a value, not an array marker — the array handling must
   *  not reach into the argument and close the space up. */
  it("leaves a bracket inside an enum value alone", () => {
    expect(mysql("enum('a [b]','c')")).toBe("enum('a [b]','c')");
    expect(mysql("set('x []','y')")).toBe("set('x []','y')");
  });

  /** Anything trailing that the dialog has no control for is carried through rather than dropped. */
  it("keeps a trailing attribute it does not model", () => {
    expect(mysql("int unsigned zerofill")).toBe("int unsigned zerofill");
  });
});

describe("a type that cannot be written without a length takes the one it suggests", () => {
  const blank = (types: readonly SqlTypeSpec[], typeName: string) =>
    composeType(types, { typeName, typeArg: "", unsigned: false, typeTail: "" } as Parameters<
      typeof composeType
    >[1]);

  /** The box shows `255` as a placeholder, so an empty box has to mean 255 rather than an error. */
  it.each([
    ["varchar", "varchar(255)"],
    ["varbinary", "varbinary(255)"],
  ])("%s", (typeName, expected) => {
    expect(blank(mysqlEditing.columnTypes, typeName)).toBe(expected);
  });

  /** An `enum`'s suggestion is a sample of the shape, not values to store: nothing is filled in for
   *  it here, and the dialog refuses to save it empty instead. */
  it.each(["enum", "set"])("%s is left empty", (typeName) => {
    expect(blank(mysqlEditing.columnTypes, typeName)).toBe(typeName);
  });

  /** PostgreSQL's `character varying` is valid with no length at all, so nothing is added. */
  it("leaves a type that is valid without one alone", () => {
    expect(blank(postgresEditing.columnTypes, "character varying")).toBe("character varying");
  });
});

describe("ClickHouse nullability travels inside the type", () => {
  /** Opens a declared column in the dialog and saves it again without touching anything. */
  function roundTrip(dataType: string, nullable: boolean): string {
    const parts = parseType(clickhouseEditing.columnTypes, unwrapNullable(dataType));
    const composed = composeType(clickhouseEditing.columnTypes, {
      ...parts,
    } as Parameters<typeof composeType>[1]);
    return wrapNullable(composed, nullable);
  }

  it("keeps the engine's own spelling of a type name", () => {
    // ClickHouse type names are case-sensitive: `uint64` is refused outright, `Code: 50
    // UNKNOWN_TYPE`. Lower-casing the parsed name was safe only while every engine's list held
    // lower-case names.
    expect(parseType(clickhouseEditing.columnTypes, "UInt64").typeName).toBe("UInt64");
    // Whatever case it arrives in, it comes back spelled the way the list spells it.
    expect(parseType(clickhouseEditing.columnTypes, "uint64").typeName).toBe("UInt64");
    // A type the list has no entry for keeps the spelling it arrived with.
    expect(parseType(clickhouseEditing.columnTypes, "Array(String)").typeName).toBe("Array");
  });

  it("unwraps a nullable column into a type the dropdown knows", () => {
    expect(unwrapNullable("Nullable(UInt64)")).toBe("UInt64");
  });

  it("leaves a type that is not one whole wrapper alone", () => {
    expect(unwrapNullable("UInt64")).toBe("UInt64");
    expect(unwrapNullable("Nullable(UInt64), Nullable(String)")).toBe(
      "Nullable(UInt64), Nullable(String)",
    );
  });

  it("unwraps only the outer layer of a nested type", () => {
    expect(unwrapNullable("Nullable(Decimal(10, 2))")).toBe("Decimal(10, 2)");
  });

  it("puts the wrapper back on the way out", () => {
    expect(roundTrip("Nullable(UInt64)", true)).toBe("Nullable(UInt64)");
    expect(roundTrip("UInt64", false)).toBe("UInt64");
    expect(roundTrip("Nullable(Decimal(10, 2))", true)).toBe("Nullable(Decimal(10, 2))");
  });

  it("never wraps twice", () => {
    expect(wrapNullable("Nullable(UInt64)", true)).toBe("Nullable(UInt64)");
  });

  it("wraps nothing when there is no type yet", () => {
    expect(wrapNullable("", true)).toBe("");
  });
});

describe("SQL Server locks an existing IDENTITY column's type/nullable/collation", () => {
  const identityColumn: SqlStructureColumn = {
    name: "id",
    dataType: "int",
    nullable: false,
    defaultValue: null,
    defaultIsExpression: false,
    autoIncrement: true,
    onUpdateCurrentTimestamp: false,
    generated: false,
    collation: null,
    comment: "",
    key: "PRI",
    extra: "identity",
  };
  const plainColumn: SqlStructureColumn = { ...identityColumn, name: "note", autoIncrement: false };

  it("locks an existing IDENTITY column on SQL Server", () => {
    expect(isIdentityLocked("mssql", true, identityColumn)).toBe(true);
  });

  it("does not lock a column that is not IDENTITY", () => {
    expect(isIdentityLocked("mssql", true, plainColumn)).toBe(false);
  });

  it("does not lock while adding a new column, even one that will be IDENTITY", () => {
    expect(isIdentityLocked("mssql", false, undefined)).toBe(false);
  });

  it("does not lock an IDENTITY-shaped column on another engine", () => {
    expect(isIdentityLocked("mysql", true, identityColumn)).toBe(false);
    expect(isIdentityLocked("postgres", true, identityColumn)).toBe(false);
  });
});

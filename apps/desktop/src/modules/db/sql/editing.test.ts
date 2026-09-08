import { describe, expect, it } from "vitest";
import { mysqlEditing } from "../mysql/editing";
import { postgresEditing } from "../postgres/editing";
import { clickhouseEditing } from "../clickhouse/editing";
import type { SqlEditing } from "./dialect";

/**
 * Both engines' dialog descriptions, checked together.
 *
 * One file rather than two because nearly every assertion here is about how the two *differ* —
 * every field of `SqlEditing` is a clause one engine has and the other has not, so a rule written
 * against one alone would be half a rule.
 */
const DIALECTS: [name: string, editing: SqlEditing][] = [
  ["mysql", mysqlEditing],
  ["postgres", postgresEditing],
  ["clickhouse", clickhouseEditing],
];

describe.each(DIALECTS)("%s column types", (name, editing) => {
  it("names each type once", () => {
    const names = editing.columnTypes.map((type) => type.name);
    expect(new Set(names).size, `${name} has a duplicate type`).toBe(names.length);
  });

  it("gives a type that cannot go without an argument something to fall back on", () => {
    // `required` means an empty box is declared with `arg` — so `arg: null`, which closes the box
    // altogether, would leave the dialog unable to produce a valid declaration at all.
    for (const type of editing.columnTypes.filter((t) => t.required)) {
      expect(type.arg, `${name}.${type.name}`).not.toBeNull();
    }
  });

  it("marks a list argument as required, its sample being no default", () => {
    // `enum`/`set` carry `'a','b'` as an illustration; declaring a column with it would be a
    // column holding the letters a and b.
    for (const type of editing.columnTypes.filter((t) => t.list)) {
      expect(type.required, `${name}.${type.name}`).toBe(true);
    }
  });

  it("only marks a type numeric where the engine has UNSIGNED at all", () => {
    const numeric = editing.columnTypes.filter((type) => type.numeric);
    if (!editing.unsigned) expect(numeric, name).toEqual([]);
    else expect(numeric.length).toBeGreaterThan(0);
  });
});

/** The two that build indexes. ClickHouse is left out on purpose: its only index-like object is
 *  the sorting key, and data skipping indexes are a design of their own that is not built yet, so
 *  `indexKinds` there is deliberately empty. */
const INDEXING = DIALECTS.filter(([name]) => name !== "clickhouse");

describe.each(INDEXING)("%s indexes", (name, editing) => {
  it("offers a primary key, which every table dialog needs", () => {
    expect(editing.indexKinds, name).toContain("primary");
  });

  it("names the primary key exactly when the engine gives it one", () => {
    // MySQL calls it `PRIMARY` and will drop it by that name; PostgreSQL names it after the table,
    // so there is nothing constant to put in the box.
    expect(editing.primaryKeyName).toBe(name === "mysql" ? "PRIMARY" : null);
  });

  it("offers at least one access method, BTREE being the one both have", () => {
    expect(editing.indexMethods, name).toContain("BTREE");
  });
});

describe("what the two engines do not share", () => {
  it("keeps MySQL's four column controls off PostgreSQL", () => {
    // Gone rather than disabled: UNSIGNED does not exist, PostgreSQL has no statement that moves
    // a column, ON UPDATE CURRENT_TIMESTAMP is a trigger here, and only text columns carry a
    // collation.
    expect(postgresEditing.unsigned).toBe(false);
    expect(postgresEditing.columnPosition).toBe(false);
    expect(postgresEditing.onUpdateCurrentTimestamp).toBe(false);
    expect(postgresEditing.databaseCollation).toBe(false);
    expect(postgresEditing.tableCollation).toBe(false);

    expect(mysqlEditing.unsigned).toBe(true);
    expect(mysqlEditing.columnPosition).toBe(true);
    expect(mysqlEditing.onUpdateCurrentTimestamp).toBe(true);
    expect(mysqlEditing.databaseCollation).toBe(true);
    expect(mysqlEditing.tableCollation).toBe(true);
  });

  it("keeps each engine's own index kinds to itself", () => {
    // FULLTEXT and SPATIAL are MySQL's two extra *kinds*; PostgreSQL's extras are access
    // *methods*, which is a different field.
    expect(mysqlEditing.indexKinds).toContain("fulltext");
    expect(mysqlEditing.indexKinds).toContain("spatial");
    expect(postgresEditing.indexKinds).not.toContain("fulltext");
    expect(postgresEditing.indexKinds).not.toContain("spatial");

    expect(postgresEditing.indexMethods).toContain("GIN");
    expect(postgresEditing.indexMethods).toContain("BRIN");
    expect(mysqlEditing.indexMethods).toEqual(["BTREE", "HASH"]);
  });

  it("offers a prefix length only where an index can have one", () => {
    expect(mysqlEditing.indexPrefix).toBe(true);
    expect(postgresEditing.indexPrefix).toBe(false);
  });
});

describe("D14 — database vs table collation", () => {
  it("keeps the two independent, MySQL having both and PostgreSQL neither", () => {
    expect(mysqlEditing.databaseCollation).toBe(true);
    expect(mysqlEditing.tableCollation).toBe(true);
    expect(postgresEditing.databaseCollation).toBe(false);
    expect(postgresEditing.tableCollation).toBe(false);
  });
});

describe("postgres column types", () => {
  it("spells them the way format_type reports them", () => {
    // The dialog is filled from the server's own answer, so a type listed under a shorter
    // spelling would leave the picker looking empty on a column that has one. These four are
    // where the two spellings differ most.
    const names = postgresEditing.columnTypes.map((type) => type.name);
    expect(names).toContain("character varying");
    expect(names).toContain("double precision");
    expect(names).toContain("timestamp with time zone");
    expect(names).toContain("timestamp without time zone");

    for (const shorthand of ["varchar", "int4", "int8", "float8", "timestamptz", "bool"]) {
      expect(names, shorthand).not.toContain(shorthand);
    }
  });
});

describe("auto increment", () => {
  it("is offered where the engine numbers a column itself", () => {
    expect(mysqlEditing.autoIncrement).toBe(true);
    expect(postgresEditing.autoIncrement).toBe(true);
  });

  it("is not offered on ClickHouse, which has nothing equivalent", () => {
    expect(clickhouseEditing.autoIncrement).toBe(false);
  });
});

describe("ClickHouse column types", () => {
  it("offers no type already wrapped in Nullable", () => {
    // Nullable is a checkbox, and it wraps around the chosen type on the way out — an entry that
    // came wrapped already would end up as `Nullable(Nullable(T))`.
    for (const type of clickhouseEditing.columnTypes) {
      expect(type.name.startsWith("Nullable"), type.name).toBe(false);
    }
  });

  it("marks no type numeric, UNSIGNED being a MySQL clause", () => {
    expect(clickhouseEditing.unsigned).toBe(false);
    for (const type of clickhouseEditing.columnTypes) {
      expect(type.numeric, type.name).not.toBe(true);
    }
  });
});


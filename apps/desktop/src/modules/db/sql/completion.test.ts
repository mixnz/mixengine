import { describe, expect, it } from "vitest";
import { completionSchema } from "./completion";
import { mssqlDialect } from "../mssql/dialect";
import { mysqlDialect } from "../mysql/dialect";
import { postgresDialect } from "../postgres/dialect";
import type { SqlSchemaOutline } from "../types";

function outlineWith(tableName: string, columnName = "id"): SqlSchemaOutline {
  return {
    database: "shop",
    tables: [
      {
        name: tableName,
        columns: [{ name: columnName, dataType: "int", nullable: false, key: "", references: null }],
      },
    ],
  };
}

/** Reaches into the `SQLNamespace` shape `completionSchema` builds — one table, one column — to
 *  read what `self`/`children[0]` say back. */
function entryFor(tableName: string, dialect: Parameters<typeof completionSchema>[1]) {
  const schema = completionSchema(outlineWith(tableName), dialect);
  const table = (schema as Record<string, Record<string, { self: unknown; children: unknown[] }>>)[
    "shop"
  ][tableName];
  return table;
}

describe("completionSchema", () => {
  it("returns null without an outline", () => {
    expect(completionSchema(null, mssqlDialect)).toBeNull();
  });

  it("applies a bare name unchanged", () => {
    const table = entryFor("orders", mssqlDialect);
    expect(table.self).toMatchObject({ label: "orders", apply: "orders" });
  });

  it("quotes a table name with a space so the completion still parses (SQL Server's own Order Details)", () => {
    const table = entryFor("Order Details", mssqlDialect);
    expect(table.self).toMatchObject({ label: "Order Details", apply: "[Order Details]" });
  });

  it("quotes a column name with a space the same way", () => {
    const table = entryFor("orders", mssqlDialect);
    const schema = completionSchema(outlineWith("orders", "unit price"), mssqlDialect);
    const t = (schema as Record<string, Record<string, { children: { label: string; apply: string }[] }>>)[
      "shop"
    ]["orders"];
    expect(t.children[0]).toMatchObject({ label: "unit price", apply: "[unit price]" });
    // Keep the other assertion from going unused.
    expect(table.self).toMatchObject({ label: "orders" });
  });

  it("uses each dialect's own quote pair", () => {
    expect(entryFor("Order Details", mysqlDialect).self).toMatchObject({ apply: "`Order Details`" });
    expect(entryFor("Order Details", postgresDialect).self).toMatchObject({ apply: '"Order Details"' });
  });

  it("quotes a name that collides with a reserved word even without a special character", () => {
    const table = entryFor("group", mysqlDialect);
    expect(table.self).toMatchObject({ apply: "`group`" });
  });

  it("doubles the closing quote character when the name itself contains one", () => {
    const table = entryFor("Order]Details", mssqlDialect);
    expect(table.self).toMatchObject({ apply: "[Order]]Details]" });
  });
});

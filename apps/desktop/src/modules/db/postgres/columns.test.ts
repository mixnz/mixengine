import { describe, expect, it } from "vitest";
import type { SqlColumnMeta } from "../types";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";

/** The tokens are written by `extra_tokens` in `src-tauri/src/modules/db/drivers/postgres.rs`, and
 *  these two files are the only ones that have to agree on them. */
const column = (extra: string, dataType = "integer"): SqlColumnMeta => ({
  dataType,
  nullable: true,
  defaultValue: null,
  extra,
  foreignKey: null,
});

describe("isAutoIncrement", () => {
  it("covers both spellings of a column the server numbers", () => {
    // An identity column, and the older `serial` — an ordinary integer whose default draws from
    // a sequence, which is why the token is the function name rather than a keyword.
    expect(isAutoIncrement(column("identity"))).toBe(true);
    expect(isAutoIncrement(column("nextval"))).toBe(true);
  });

  it("is false for a plain column", () => {
    expect(isAutoIncrement(column(""))).toBe(false);
    expect(isAutoIncrement(column("generated"))).toBe(false);
  });
});

describe("isGenerated", () => {
  it("is true for a column PostgreSQL computes from the others", () => {
    expect(isGenerated(column("generated"))).toBe(true);
    expect(isGenerated(column(""))).toBe(false);
  });
});

describe("isServerAssigned", () => {
  it("covers everything an INSERT must not name", () => {
    for (const extra of ["identity", "nextval", "generated"]) {
      expect(isServerAssigned(column(extra)), extra).toBe(true);
    }
    expect(isServerAssigned(column(""))).toBe(false);
  });
});

describe("isBinary", () => {
  it("is a comparison rather than a suffix match", () => {
    // PostgreSQL has exactly one type holding bytes, where MySQL has six — so a column merely
    // ending in the word is not one, and reading it as base64 would mangle it.
    expect(isBinary(column("", "bytea"))).toBe(true);
    expect(isBinary(column("", "BYTEA"))).toBe(true);
    expect(isBinary(column("", "  bytea  "))).toBe(true);
    expect(isBinary(column("", "bytea[]"))).toBe(false);
    expect(isBinary(column("", "text"))).toBe(false);
  });
});

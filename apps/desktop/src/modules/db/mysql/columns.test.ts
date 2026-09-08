import { describe, expect, it } from "vitest";
import { isBinary } from "./columns";
import type { SqlColumnMeta } from "../types";

function meta(dataType: string): SqlColumnMeta {
  return { dataType, nullable: true, defaultValue: null, extra: "", foreignKey: null };
}

describe("isBinary", () => {
  it("knows the types that arrive as bytes", () => {
    for (const type of ["binary(16)", "varbinary(255)", "blob", "tinyblob", "mediumblob", "longblob"]) {
      expect(isBinary(meta(type))).toBe(true);
    }
  });

  it("leaves text and everything else alone", () => {
    // `varchar` ends in neither word, and `text` is the type a blob is most easily confused with.
    for (const type of ["varchar(255)", "char(2)", "text", "longtext", "json", "int unsigned"]) {
      expect(isBinary(meta(type))).toBe(false);
    }
  });

  it("reads the type however MySQL happens to spell it", () => {
    expect(isBinary(meta("VARBINARY(16)"))).toBe(true);
    expect(isBinary(meta("BLOB"))).toBe(true);
  });
});

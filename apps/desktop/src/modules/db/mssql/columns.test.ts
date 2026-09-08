import { describe, expect, it } from "vitest";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import type { SqlColumnMeta } from "../types";

function meta(dataType: string, extra = ""): SqlColumnMeta {
  return { dataType, nullable: true, defaultValue: null, extra, foreignKey: null };
}

describe("what SQL Server fills in for itself", () => {
  it("reads the tokens the backend writes", () => {
    expect(isAutoIncrement(meta("int", "identity"))).toBe(true);
    expect(isGenerated(meta("int", "generated"))).toBe(true);
    expect(isAutoIncrement(meta("int", ""))).toBe(false);
  });

  /**
   * A `rowversion` is the third kind, and the one that is easy to miss: it is neither IDENTITY nor
   * computed, but the server stamps it on every write and refuses an INSERT that names it. Row
   * writes land in Plan 3 — this is what they will read.
   */
  it("counts a rowversion as server-assigned even though it is neither of the other two", () => {
    expect(isServerAssigned(meta("timestamp", "rowversion"))).toBe(true);
    expect(isAutoIncrement(meta("timestamp", "rowversion"))).toBe(false);
    expect(isServerAssigned(meta("int", ""))).toBe(false);
  });

  /** The types the backend hands over base64-encoded — the grid has to know not to show them as
   *  the text they arrive as. */
  it("names every binary type, whatever its declared width", () => {
    expect(isBinary(meta("varbinary(max)"))).toBe(true);
    expect(isBinary(meta("binary(8)"))).toBe(true);
    expect(isBinary(meta("image"))).toBe(true);
    expect(isBinary(meta("timestamp"))).toBe(true);
    expect(isBinary(meta("nvarchar(255)"))).toBe(false);
  });
});

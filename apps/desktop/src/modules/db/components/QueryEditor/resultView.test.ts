import { describe, expect, it } from "vitest";
import { compareValues, nextSort, rowMatches, viewIndexes, type Sort } from "./resultView";

const ASC: Sort = { column: 0, direction: "asc" };
const DESC: Sort = { column: 0, direction: "desc" };

describe("compareValues", () => {
  it("orders numbers by size, not by their spelling", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
  });

  it("orders bigints by size", () => {
    expect(compareValues(2n, 10n)).toBeLessThan(0);
  });

  it("reads the digits inside a string as a number", () => {
    expect(compareValues("item2", "item10")).toBeLessThan(0);
  });

  it("puts nothing after something", () => {
    expect(compareValues(null, 1)).toBeGreaterThan(0);
    expect(compareValues(1, undefined)).toBeLessThan(0);
    expect(compareValues(null, undefined)).toBe(0);
  });
});

describe("nextSort", () => {
  it("starts a fresh column ascending", () => {
    expect(nextSort(null, 3)).toEqual({ column: 3, direction: "asc" });
    expect(nextSort(ASC, 3)).toEqual({ column: 3, direction: "asc" });
  });

  it("turns the same column round, then off", () => {
    expect(nextSort(ASC, 0)).toEqual({ column: 0, direction: "desc" });
    expect(nextSort(DESC, 0)).toBeNull();
  });
});

describe("rowMatches", () => {
  const row = [1, "Ada Lovelace", null];

  it("matches part of a cell, either case", () => {
    expect(rowMatches(row, "love")).toBe(true);
    expect(rowMatches(row, "LOVE")).toBe(true);
  });

  it("matches a number the way the grid shows it", () => {
    expect(rowMatches(row, "1")).toBe(true);
  });

  it("says no when nothing holds it", () => {
    expect(rowMatches(row, "babbage")).toBe(false);
  });

  it("takes a bare asterisk literally rather than as a pattern", () => {
    expect(rowMatches(row, "*")).toBe(false);
  });

  it("matches everything on an empty needle", () => {
    expect(rowMatches(row, "")).toBe(true);
  });
});

describe("viewIndexes", () => {
  const rows: unknown[][] = [
    [3, "c"],
    [1, "a"],
    [null, "b"],
    [1, "d"],
  ];

  it("hands back the rows in order when nothing is asked of it", () => {
    expect(viewIndexes(rows, null, "")).toEqual([0, 1, 2, 3]);
  });

  it("sorts ascending with nothing at the end", () => {
    expect(viewIndexes(rows, ASC, "")).toEqual([1, 3, 0, 2]);
  });

  it("keeps nothing at the end descending too", () => {
    expect(viewIndexes(rows, DESC, "")).toEqual([0, 1, 3, 2]);
  });

  it("breaks a tie on the original order, both ways round", () => {
    expect(viewIndexes(rows, ASC, "").slice(0, 2)).toEqual([1, 3]);
    expect(viewIndexes(rows, DESC, "").slice(1, 3)).toEqual([1, 3]);
  });

  it("filters, and the indexes are still the original ones", () => {
    expect(viewIndexes(rows, null, "a")).toEqual([1]);
  });

  it("filters before it sorts", () => {
    expect(viewIndexes(rows, DESC, "1")).toEqual([1, 3]);
  });

  it("ignores space either side of the needle", () => {
    expect(viewIndexes(rows, null, "  a  ")).toEqual([1]);
  });

  it("hands back nothing when nothing matches", () => {
    expect(viewIndexes(rows, null, "zzz")).toEqual([]);
  });
});

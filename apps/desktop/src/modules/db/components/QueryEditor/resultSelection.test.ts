import { describe, expect, it } from "vitest";
import { allRows, cutOut, pickRow, stepRow, type Selection } from "./resultSelection";

const PLAIN = { extend: false, toggle: false };
const SHIFT = { extend: true, toggle: false };
const MOD = { extend: false, toggle: true };
const BOTH = { extend: true, toggle: true };

/** Rows 1 and 2 chosen by a Shift+click that started on 1. */
const ONE_TO_TWO: Selection = { rows: new Set([1, 2]), anchor: 1, focus: 2 };

/** `Set` compares by identity under `toEqual`, so the rows come out as a sorted list instead. */
function chosen(selection: Selection | null): number[] {
  return selection === null ? [] : [...selection.rows].sort((a, b) => a - b);
}

describe("pickRow", () => {
  it("takes the one row that was clicked", () => {
    expect(pickRow(ONE_TO_TWO, 4, PLAIN)).toEqual({ rows: new Set([4]), anchor: 4, focus: 4 });
  });

  it("stretches from the anchor when the click extends", () => {
    const next = pickRow(ONE_TO_TWO, 4, SHIFT);
    expect(chosen(next)).toEqual([1, 2, 3, 4]);
    expect(next.anchor).toBe(1);
    expect(next.focus).toBe(4);
  });

  it("stretches upwards just as readily", () => {
    expect(chosen(pickRow({ rows: new Set([3]), anchor: 3, focus: 3 }, 1, SHIFT))).toEqual([1, 2, 3]);
  });

  it("replaces what was chosen when it stretches without the modifier", () => {
    const wide: Selection = { rows: new Set([7, 8]), anchor: 1, focus: 1 };
    expect(chosen(pickRow(wide, 2, SHIFT))).toEqual([1, 2]);
  });

  it("adds the stretch to what was chosen when the modifier is held too", () => {
    const wide: Selection = { rows: new Set([7, 8]), anchor: 1, focus: 1 };
    expect(chosen(pickRow(wide, 2, BOTH))).toEqual([1, 2, 7, 8]);
  });

  it("adds a row the modifier lands on", () => {
    expect(chosen(pickRow(ONE_TO_TWO, 5, MOD))).toEqual([1, 2, 5]);
  });

  it("takes away a row the modifier lands on again", () => {
    expect(chosen(pickRow(ONE_TO_TWO, 2, MOD))).toEqual([1]);
  });

  it("has nothing to extend from when nothing is selected", () => {
    expect(pickRow(null, 3, SHIFT)).toEqual({ rows: new Set([3]), anchor: 3, focus: 3 });
    expect(pickRow(null, 3, MOD)).toEqual({ rows: new Set([3]), anchor: 3, focus: 3 });
  });
});

describe("allRows", () => {
  it("takes every row", () => {
    expect(chosen(allRows(4))).toEqual([0, 1, 2, 3]);
  });

  it("takes nothing from an empty grid", () => {
    expect(allRows(0)).toBeNull();
  });
});

describe("stepRow", () => {
  it("starts on the first row when nothing is selected", () => {
    expect(stepRow(null, 1, false, 4)).toEqual({ rows: new Set([0]), anchor: 0, focus: 0 });
  });

  it("moves onto the next row alone", () => {
    expect(stepRow(ONE_TO_TWO, 1, false, 6)).toEqual({ rows: new Set([3]), anchor: 3, focus: 3 });
  });

  it("stretches from the anchor when it extends", () => {
    const next = stepRow(ONE_TO_TWO, 1, true, 6);
    expect(chosen(next)).toEqual([1, 2, 3]);
    expect(next?.anchor).toBe(1);
  });

  it("shrinks back past the anchor rather than growing both ways", () => {
    expect(chosen(stepRow(ONE_TO_TWO, -1, true, 6))).toEqual([1]);
  });

  it("stops at the edges rather than wrapping", () => {
    expect(stepRow(ONE_TO_TWO, -9, false, 6)?.focus).toBe(0);
    expect(stepRow(ONE_TO_TWO, 9, false, 6)?.focus).toBe(5);
  });

  it("has nowhere to go in an empty grid", () => {
    expect(stepRow(null, 1, false, 0)).toBeNull();
  });
});

describe("cutOut", () => {
  const rows: unknown[][] = [
    ["a0", "b0", "c0"],
    ["a1", "b1", "c1"],
    ["a2", "b2", "c2"],
  ];
  const columns = ["a", "b", "c"];

  it("takes whole rows, and takes them through the view", () => {
    const view = [2, 0, 1];
    const cut = cutOut({ rows: new Set([0, 2]), anchor: 0, focus: 2 }, view, rows, columns);
    expect(cut.columns).toEqual(columns);
    expect(cut.rows).toEqual([
      ["a2", "b2", "c2"],
      ["a1", "b1", "c1"],
    ]);
  });

  it("puts them in the order they are on screen, not the order they were clicked", () => {
    const cut = cutOut({ rows: new Set([2, 0]), anchor: 2, focus: 0 }, [0, 1, 2], rows, columns);
    expect(cut.rows).toEqual([
      ["a0", "b0", "c0"],
      ["a2", "b2", "c2"],
    ]);
  });

  it("takes a single row", () => {
    const cut = cutOut({ rows: new Set([1]), anchor: 1, focus: 1 }, [0, 1, 2], rows, columns);
    expect(cut).toEqual({ columns, rows: [["a1", "b1", "c1"]] });
  });
});

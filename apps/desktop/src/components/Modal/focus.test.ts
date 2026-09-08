import { describe, expect, it } from "vitest";
import { nextFocusIndex } from "./focus";

describe("nextFocusIndex", () => {
  it("moves forwards and backwards", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, true)).toBe(1);
  });

  it("wraps rather than letting focus out of the dialog", () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it("takes focus that is not in the list to whichever end it is heading for", () => {
    // Focus on the dialog itself, or lost outside it: the next press has to bring it back in.
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });

  it("has nowhere to go in a dialog with nothing focusable", () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });

  it("stays put in a dialog with one control, whichever way Tab goes", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
});

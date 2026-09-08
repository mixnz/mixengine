import { describe, expect, it } from "vitest";
import { pointInRects } from "./nativeContextMenu";

/** One line of selected text, 100 wide and 20 tall, at the top left. */
const LINE = { left: 10, right: 110, top: 10, bottom: 30 };

/** A selection running over two lines, as `getClientRects` returns it. */
const TWO_LINES = [LINE, { left: 10, right: 60, top: 30, bottom: 50 }];

describe("pointInRects", () => {
  it("takes a point inside the rectangle", () => {
    expect(pointInRects(50, 20, [LINE])).toBe(true);
  });

  it("takes a point on the edge", () => {
    expect(pointInRects(110, 30, [LINE])).toBe(true);
  });

  it("refuses a point beside the rectangle", () => {
    expect(pointInRects(200, 20, [LINE])).toBe(false);
  });

  it("refuses a point above or below it", () => {
    expect(pointInRects(50, 5, [LINE])).toBe(false);
    expect(pointInRects(50, 40, [LINE])).toBe(false);
  });

  it("takes a point on any line of a selection", () => {
    expect(pointInRects(30, 40, TWO_LINES)).toBe(true);
  });

  it("refuses a point past the end of the last line", () => {
    expect(pointInRects(90, 40, TWO_LINES)).toBe(false);
  });

  it("refuses anything when nothing is selected", () => {
    expect(pointInRects(50, 20, [])).toBe(false);
  });
});

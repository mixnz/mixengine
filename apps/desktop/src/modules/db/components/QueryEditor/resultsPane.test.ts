import { describe, expect, it } from "vitest";
import { MIN_EDITOR, MIN_HEIGHT, fitHeight } from "./resultsPane";

/** A tab with plenty of room: nothing is at a limit, so a height is whatever was asked for. */
const ROOM = 800;

describe("fitHeight", () => {
  it("gives back what it was asked for when there is room for it", () => {
    expect(fitHeight(300, ROOM)).toBe(300);
  });

  it("rounds, since a pointer moves in fractions and a height is a pixel", () => {
    expect(fitHeight(300.4, ROOM)).toBe(300);
  });

  it("does not go below the floor", () => {
    expect(fitHeight(10, ROOM)).toBe(MIN_HEIGHT);
  });

  // The bug this function exists to make testable: the room is the editor's and the pane's
  // together, so the ceiling leaves the editor its minimum and not a pixel of anyone else's.
  it("leaves the editor its minimum", () => {
    expect(fitHeight(ROOM, ROOM)).toBe(ROOM - MIN_EDITOR);
  });

  // A tab too short to give both their minimum: the floor wins, and what overflows is the editor,
  // which scrolls. The alternative is a pane too short to read, which nobody asked for.
  it("keeps the floor when the room cannot pay for both", () => {
    expect(fitHeight(400, 200)).toBe(MIN_HEIGHT);
  });

  // Before the first layout there is nothing measured yet, and clamping against zero would snap
  // the pane to its floor on the frame before it is drawn.
  it("clamps only to the floor while nothing has been measured", () => {
    expect(fitHeight(400, 0)).toBe(400);
  });
});

import { describe, expect, it } from "vitest";
import { placeContextMenu } from "./contextMenuPosition";

/** The margin the placement keeps from the window edge, repeated rather than imported: a test that
 *  reads the number it is checking against cannot notice that number changing. */
const MARGIN = 8;

/** A window, and a menu of a few entries in it. */
const WIDTH = 1000;
const HEIGHT = 700;
const MENU_W = 180;
const MENU_H = 120;

describe("placeContextMenu", () => {
  it("hangs the menu below and right of the pointer when there is room", () => {
    expect(placeContextMenu(300, 200, MENU_W, MENU_H, WIDTH, HEIGHT)).toEqual({
      left: 300,
      top: 200,
      transformOrigin: "top left",
    });
  });

  it("flips above the pointer near the bottom edge, rather than off it", () => {
    const { top, transformOrigin } = placeContextMenu(300, 660, MENU_W, MENU_H, WIDTH, HEIGHT);
    expect(top).toBe(660 - MENU_H);
    expect(transformOrigin).toBe("bottom left");
  });

  it("flips left of the pointer near the right edge", () => {
    const { left, transformOrigin } = placeContextMenu(960, 200, MENU_W, MENU_H, WIDTH, HEIGHT);
    expect(left).toBe(960 - MENU_W);
    expect(transformOrigin).toBe("top right");
  });

  it("flips both ways at once in the bottom-right corner", () => {
    expect(placeContextMenu(960, 660, MENU_W, MENU_H, WIDTH, HEIGHT)).toEqual({
      left: 960 - MENU_W,
      top: 660 - MENU_H,
      transformOrigin: "bottom right",
    });
  });

  it("slides back inside when neither side of the pointer has the room", () => {
    // A window barely taller than the menu, clicked in the middle of it: nothing fits below the
    // pointer and nothing fits above it either, so the menu slides up off the pointer instead of
    // flipping over it.
    const short = MENU_H + 40;
    const { top, transformOrigin } = placeContextMenu(300, 100, MENU_W, MENU_H, WIDTH, short);
    expect(top).toBe(short - MENU_H - MARGIN);
    expect(transformOrigin).toBe("top left");
  });

  it("keeps the near edge visible for a menu taller than the window", () => {
    const { top } = placeContextMenu(300, 400, MENU_W, 900, WIDTH, HEIGHT);
    expect(top).toBe(MARGIN);
  });
});

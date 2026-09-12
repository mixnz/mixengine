import { describe, expect, it } from "vitest";
import { isAtBottom } from "./tailScroll";

/* A 200px-tall log pane holding 1000px of lines: its end is scrollTop 800. Round numbers, chosen
   to read the distance off the page rather than to match any real pane. */
const PANE = { clientHeight: 200, scrollHeight: 1000 };

describe("isAtBottom", () => {
  it("follows a pane resting on its own end", () => {
    expect(isAtBottom({ ...PANE, scrollTop: 800 })).toBe(true);
  });

  /* scrollTop is fractional on a scaled display while clientHeight and scrollHeight are whole
     numbers, so a pane sitting exactly at its end still reports a pixel or two short of it.
     Calling that "scrolled up" would drop the tail the moment the window moved to a 125% screen. */
  it("follows a pane a rounded pixel short of its end", () => {
    expect(isAtBottom({ ...PANE, scrollTop: 798.5 })).toBe(true);
  });

  it("stops following a pane scrolled up a line", () => {
    expect(isAtBottom({ ...PANE, scrollTop: 784 })).toBe(false);
  });

  /* Nothing to scroll: the first few lines of an apply are all visible at once, and the pane is at
     its end by having no other place to be. It must keep following, or the tail would only start
     once the output outgrew the panel. */
  it("follows a pane with nothing to scroll", () => {
    expect(isAtBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 120 })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { centeredScrollTop } from "./scroll";

describe("centeredScrollTop", () => {
  it("leaves a list that does not scroll where it is", () => {
    expect(
      centeredScrollTop({ itemTop: 68, itemHeight: 34, viewportHeight: 200, scrollHeight: 170 }),
    ).toBe(0);
  });

  it("puts an option in the middle of the list", () => {
    // A 34px row starting at 340 has its middle at 357; a 200px viewport centred on that starts
    // at 257, and there is room on both sides of it for that to happen.
    expect(
      centeredScrollTop({ itemTop: 340, itemHeight: 34, viewportHeight: 200, scrollHeight: 680 }),
    ).toBe(257);
  });

  it("holds the top of the list rather than scrolling past it", () => {
    expect(
      centeredScrollTop({ itemTop: 0, itemHeight: 34, viewportHeight: 200, scrollHeight: 680 }),
    ).toBe(0);
  });

  it("holds the bottom of the list rather than scrolling past it", () => {
    expect(
      centeredScrollTop({ itemTop: 646, itemHeight: 34, viewportHeight: 200, scrollHeight: 680 }),
    ).toBe(480);
  });

  /* An option taller than the room it is being centred in — a wrapped label in a short menu. The
     middle of the two still line up, which puts the option's own top above the viewport's; the
     clamp is what keeps that from becoming a negative scroll. */
  it("centres an option taller than the viewport as far as the list allows", () => {
    expect(
      centeredScrollTop({ itemTop: 300, itemHeight: 260, viewportHeight: 200, scrollHeight: 680 }),
    ).toBe(330);
  });
});

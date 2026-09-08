import { describe, expect, it } from "vitest";
import { clampRatio, clampSize } from "./clamp";

describe("clampSize", () => {
  it("adds the drag to where the drag started", () => {
    expect(clampSize(240, 60, 160, 480)).toBe(300);
  });

  it("moves left on a negative drag", () => {
    expect(clampSize(240, -60, 160, 480)).toBe(180);
  });

  it("stops at the minimum however far the pointer goes", () => {
    expect(clampSize(240, -900, 160, 480)).toBe(160);
  });

  it("stops at the maximum", () => {
    expect(clampSize(240, 900, 160, 480)).toBe(480);
  });
});

describe("clampRatio", () => {
  it("turns a drag in pixels into a share of the whole", () => {
    expect(clampRatio(0.5, 100, 1000, 0.2, 0.8)).toBeCloseTo(0.6);
  });

  it("stops at the minimum share", () => {
    expect(clampRatio(0.5, -1000, 1000, 0.2, 0.8)).toBeCloseTo(0.2);
  });

  it("stops at the maximum share", () => {
    expect(clampRatio(0.5, 1000, 1000, 0.2, 0.8)).toBeCloseTo(0.8);
  });

  // A pane laid out but not yet measured reports zero, and dividing by it would give NaN — which
  // travels into a style attribute and collapses the layout rather than failing anywhere visible.
  it("leaves the ratio alone when the container has no width yet", () => {
    expect(clampRatio(0.5, 100, 0, 0.2, 0.8)).toBe(0.5);
  });
});

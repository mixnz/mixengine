import { describe, expect, it } from "vitest";
import { tabKeyDown } from "./keyboard";

function press(key: string) {
  const calls = { selected: 0, prevented: 0 };
  tabKeyDown(() => {
    calls.selected += 1;
  })({
    key,
    preventDefault: () => {
      calls.prevented += 1;
    },
  });
  return calls;
}

describe("tabKeyDown", () => {
  it("selects on Enter", () => {
    expect(press("Enter").selected).toBe(1);
  });

  it("selects on Space", () => {
    expect(press(" ").selected).toBe(1);
  });

  // Without this the page scrolls under the tab that was just chosen.
  it("swallows the Space that would otherwise scroll the page", () => {
    expect(press(" ").prevented).toBe(1);
  });

  it("leaves other keys alone, arrows and Tab included", () => {
    for (const key of ["a", "Tab", "ArrowRight", "Escape"]) {
      expect(press(key)).toEqual({ selected: 0, prevented: 0 });
    }
  });
});

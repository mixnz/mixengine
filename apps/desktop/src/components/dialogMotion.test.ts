import { describe, expect, it } from "vitest";
import { isUnhandledEscape } from "./dialogMotion";

/** A key press, only as much of one as the predicate reads. The suite runs without a DOM, so
 *  there is no real `KeyboardEvent` to build. */
const press = (key: string, defaultPrevented = false) =>
  ({ key, defaultPrevented }) as KeyboardEvent;

describe("isUnhandledEscape", () => {
  it("takes an Escape nobody has answered", () => {
    expect(isUnhandledEscape(press("Escape"))).toBe(true);
  });

  /* The whole reason it exists. A `Select` with its menu open calls `preventDefault` on Escape,
     and every dialog listens on `window`, so without this the press that closed the menu also
     threw away the form around it. */
  it("leaves an Escape a control inside the dialog has already answered", () => {
    expect(isUnhandledEscape(press("Escape", true))).toBe(false);
  });

  it("is not interested in any other key", () => {
    expect(isUnhandledEscape(press("Enter"))).toBe(false);
    expect(isUnhandledEscape(press("Esc"))).toBe(false);
  });
});

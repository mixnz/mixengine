import { describe, expect, it } from "vitest";
import { savedChange } from "./followSaved";

describe("a form showing a saved entry, when the saved list changes", () => {
  it("does nothing while the entry is as it was when the form took it", () => {
    expect(savedChange("A", "A", "A")).toBe("none");
    expect(savedChange("A", "A", "edited")).toBe("none");
  });

  it("does nothing for a form that took no saved entry", () => {
    expect(savedChange(undefined, null, "anything")).toBe("none");
  });

  it("reloads an untouched form", () => {
    expect(savedChange("B", "A", "A")).toBe("reload");
  });

  it("reloads a form that already says what the entry now says: its own save, coming back", () => {
    expect(savedChange("B", "A", "B")).toBe("reload");
  });

  it("leaves an edited form alone, and says the entry changed", () => {
    expect(savedChange("B", "A", "edited")).toBe("changed");
  });

  it("says the entry is gone", () => {
    expect(savedChange(undefined, "A", "A")).toBe("removed");
  });
});

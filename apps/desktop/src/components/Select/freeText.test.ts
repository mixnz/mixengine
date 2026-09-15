import { describe, expect, it } from "vitest";
import { typedValue } from "./freeText";

const installed = ["8.3.12", "8.2.23", "7.4.33"];

describe("typedValue", () => {
  it("offers nothing while the box is empty", () => {
    expect(typedValue("", installed)).toBeNull();
  });

  it("offers nothing for a box holding only spaces", () => {
    expect(typedValue("   ", installed)).toBeNull();
  });

  it("offers what was typed when no installed version is spelled that way", () => {
    expect(typedValue("^8.3", installed)).toBe("^8.3");
  });

  /* `8.3` is a prefix constraint — it selects whatever `8.3.x` is installed — so it is worth
     offering even though `8.3.12` is in the list. Only a value spelled exactly like an option
     would be the same row twice. */
  it("offers a prefix that no option is spelled as, even when options begin with it", () => {
    expect(typedValue("8.3", installed)).toBe("8.3");
  });

  it("offers nothing when an option is already spelled exactly that way", () => {
    expect(typedValue("8.3.12", installed)).toBeNull();
  });

  it("offers the trimmed value, which is what a pin would be saved as", () => {
    expect(typedValue("  ^8.2  ", installed)).toBe("^8.2");
  });

  /* Trimming happens before the comparison too, or a trailing space would offer a row that
     commits to the value already sitting above it. */
  it("offers nothing when the value matches an option once trimmed", () => {
    expect(typedValue(" 7.4.33 ", installed)).toBeNull();
  });

  it("offers what was typed when there is nothing installed to compare against", () => {
    expect(typedValue("8.3", [])).toBe("8.3");
  });
});

import { describe, expect, it } from "vitest";
import { confirmEnabled } from "./OrderByDialog";

describe("the rebuild confirm gate", () => {
  it("stays locked until the typed text exactly matches the table name", () => {
    expect(confirmEnabled("", "orders", 1)).toBe(false);
    expect(confirmEnabled("order", "orders", 1)).toBe(false);
    expect(confirmEnabled("Orders", "orders", 1)).toBe(false);
    expect(confirmEnabled("orders", "orders", 1)).toBe(true);
  });

  it("trims surrounding whitespace off what was typed", () => {
    expect(confirmEnabled("  orders  ", "orders", 1)).toBe(true);
  });

  it("stays locked with no column chosen even when the name matches", () => {
    expect(confirmEnabled("orders", "orders", 0)).toBe(false);
  });
});

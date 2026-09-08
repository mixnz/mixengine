import { describe, expect, it } from "vitest";
import { reloadTarget } from "./reloadTarget";

describe("reloadTarget", () => {
  it("reloads the keyspace when nothing is open on the right", () => {
    expect(reloadTarget(null, false)).toBe("left");
  });

  it("reloads the value once a key is open", () => {
    expect(reloadTarget(null, true)).toBe("right");
  });

  it("follows the pane the user touched last", () => {
    expect(reloadTarget("left", true)).toBe("left");
    expect(reloadTarget("right", true)).toBe("right");
  });

  it("still reloads the keyspace when the right was touched but holds no value", () => {
    // Ví dụ: tab Group, hoặc lời nhắc chọn key. Không có gì bên phải để đọc lại.
    expect(reloadTarget("right", false)).toBe("left");
  });

  it("reloads the keyspace when the sidebar was touched and no key is open", () => {
    expect(reloadTarget("left", false)).toBe("left");
  });
});

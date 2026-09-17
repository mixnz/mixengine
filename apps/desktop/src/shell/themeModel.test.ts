import { describe, expect, it } from "vitest";
import { clearRetiredKeys, RETIRED_KEYS } from "./themeModel";

describe("clearRetiredKeys", () => {
  it("removes the stored glass setting", () => {
    const removed: string[] = [];
    clearRetiredKeys({ removeItem: (key) => void removed.push(key) });
    expect(removed).toEqual(["mixdb-glass"]);
    expect(RETIRED_KEYS).toEqual(["mixdb-glass"]);
  });
});

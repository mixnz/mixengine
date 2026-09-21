import { describe, expect, it } from "vitest";
import { groupsOf, pickTwo, typedBack } from "./ceremony";

/** The shape `format_recovery_key` produces: thirteen groups of four (D2). */
const KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD-EFGH-JKMN-PQRS-TV00";

describe("the recovery key's groups", () => {
  it("are thirteen", () => {
    expect(groupsOf(KEY)).toHaveLength(13);
  });

  it("two of which are asked for, never the same one twice", () => {
    expect(pickTwo(13, () => 0)).toEqual([0, 1]);
    expect(pickTwo(13, () => 0.999)).toEqual([11, 12]);
    for (let n = 0; n < 50; n += 1) {
      const [first, second] = pickTwo(13);
      expect(first).toBeLessThan(second);
      expect(second).toBeLessThan(13);
    }
  });
});

describe("typing two groups back", () => {
  it("forgives case and spacing, as the key's own parser does", () => {
    expect(typedBack(KEY, [2, 6], ["jkmn", " 2345 "])).toBe(true);
  });

  it("is strict about the characters", () => {
    expect(typedBack(KEY, [2, 6], ["JKMN", "2346"])).toBe(false);
    expect(typedBack(KEY, [2, 6], ["JKMN"])).toBe(false);
    expect(typedBack(KEY, [2, 40], ["JKMN", ""])).toBe(false);
  });
});

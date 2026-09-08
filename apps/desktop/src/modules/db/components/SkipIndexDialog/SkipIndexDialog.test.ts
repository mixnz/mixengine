import { describe, expect, it } from "vitest";
import { argLabels } from "./SkipIndexDialog";

describe("skip index argument labels", () => {
  it("uses the whitelist's own labels when the argument count matches", () => {
    expect(argLabels("set", 1)).toEqual(["max rows (0 = unlimited)"]);
    expect(argLabels("tokenbf_v1", 3)).toEqual([
      "size of bloom filter (bytes)",
      "number of hash functions",
      "random seed",
    ]);
  });

  it("falls back to generic labels for a TYPE outside the whitelist", () => {
    expect(argLabels("mystery_type", 2)).toEqual(["argument 1", "argument 2"]);
  });

  it("falls back when the argument count does not match the whitelist's own", () => {
    // An index somehow reporting four arguments for tokenbf_v1 (which really takes three) should
    // not be shown wearing labels meant for a different count.
    expect(argLabels("tokenbf_v1", 4)).toEqual([
      "argument 1",
      "argument 2",
      "argument 3",
      "argument 4",
    ]);
  });
});

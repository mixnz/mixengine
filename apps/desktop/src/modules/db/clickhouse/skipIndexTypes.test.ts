import { describe, expect, it } from "vitest";
import { SKIP_INDEX_TYPES, defaultArgs, skipIndexType } from "./skipIndexTypes";

describe("ClickHouse skip index TYPE whitelist", () => {
  it("has exactly the five verified TYPEs, in the order shown", () => {
    expect(SKIP_INDEX_TYPES.map((t) => t.name)).toEqual([
      "minmax",
      "set",
      "bloom_filter",
      "ngrambf_v1",
      "tokenbf_v1",
    ]);
  });

  it("gives each TYPE the argument count verified against the test server", () => {
    expect(skipIndexType("minmax")?.args).toHaveLength(0);
    expect(skipIndexType("set")?.args).toHaveLength(1);
    expect(skipIndexType("bloom_filter")?.args).toHaveLength(1);
    expect(skipIndexType("ngrambf_v1")?.args).toHaveLength(4);
    // Not 4 like `ngrambf_v1` — verified against the test server, which rejects a fourth argument
    // with "tokenbf index must have exactly 3 arguments".
    expect(skipIndexType("tokenbf_v1")?.args).toHaveLength(3);
  });

  it("gives a fresh dialog its placeholders as the starting values", () => {
    expect(defaultArgs(skipIndexType("bloom_filter")!)).toEqual(["0.025"]);
    expect(defaultArgs(skipIndexType("minmax")!)).toEqual([]);
  });

  it("is undefined for a name outside the whitelist", () => {
    expect(skipIndexType("mystery_type")).toBeUndefined();
  });
});

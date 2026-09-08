import { describe, expect, it } from "vitest";
import { fileInto } from "./paneCache";

describe("fileInto", () => {
  it("files an entry and answers with it", () => {
    const cache = new Map<string, number>();
    fileInto(cache, "a", 1, 3);
    expect(cache.get("a")).toBe(1);
  });

  it("lets the oldest go once the cache is over the limit", () => {
    const cache = new Map<string, number>();
    for (const key of ["a", "b", "c"]) fileInto(cache, key, 1, 2);
    expect([...cache.keys()]).toEqual(["b", "c"]);
  });

  it("moves an entry come back to to the end of the order", () => {
    // Without the delete before the set, the two things a user is moving between take turns being
    // thrown away — which is the one access pattern a cache this small has to survive.
    const cache = new Map<string, number>();
    fileInto(cache, "a", 1, 2);
    fileInto(cache, "b", 1, 2);
    fileInto(cache, "a", 2, 2);
    fileInto(cache, "c", 1, 2);
    expect([...cache.keys()]).toEqual(["a", "c"]);
    expect(cache.get("a")).toBe(2);
  });

  it("replaces an entry rather than counting it twice", () => {
    const cache = new Map<string, number>();
    fileInto(cache, "a", 1, 3);
    fileInto(cache, "a", 2, 3);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("keeps the newest when the cache is already well over the limit", () => {
    // What a limit lowered between two visits looks like: several go at once, not one.
    const cache = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
    fileInto(cache, "e", 5, 2);
    expect([...cache.keys()]).toEqual(["d", "e"]);
  });

  it("keeps only the entry just filed when the limit is one", () => {
    const cache = new Map<string, number>();
    fileInto(cache, "a", 1, 1);
    fileInto(cache, "b", 2, 1);
    expect([...cache.entries()]).toEqual([["b", 2]]);
  });

  it("empties itself under a limit of zero rather than looping", () => {
    const cache = new Map<string, number>();
    fileInto(cache, "a", 1, 0);
    expect(cache.size).toBe(0);
  });
});

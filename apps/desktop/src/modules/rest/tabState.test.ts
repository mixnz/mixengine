import { describe, expect, it } from "vitest";
import { parseRestTabState } from "./tabState";

describe("parseRestTabState", () => {
  it("reads back what the tab wrote", () => {
    expect(parseRestTabState({ openIds: ["r-1", "r-2"], activeId: "r-2" })).toEqual({
      openIds: ["r-1", "r-2"],
      activeId: "r-2",
    });
  });

  it("takes a strip with nothing chosen on it", () => {
    expect(parseRestTabState({ openIds: ["r-1"], activeId: null })).toEqual({
      openIds: ["r-1"],
      activeId: null,
    });
  });

  it("copies the ids rather than keeping the parsed array", () => {
    const stored = { openIds: ["r-1"], activeId: null };
    expect(parseRestTabState(stored)?.openIds).not.toBe(stored.openIds);
  });

  it("has nothing to say about an empty strip", () => {
    // Nothing to reopen, and the writing side never produces this — it forgets the state instead.
    expect(parseRestTabState({ openIds: [], activeId: null })).toBeNull();
  });

  it("has nothing to say about a tab that never wrote any", () => {
    expect(parseRestTabState(undefined)).toBeNull();
  });

  /* Everything here is a string some other version of the app put in `localStorage`. */
  it("gives up on anything that is not a REST tab's state", () => {
    expect(parseRestTabState(null)).toBeNull();
    expect(parseRestTabState("r-1")).toBeNull();
    expect(parseRestTabState(["r-1"])).toBeNull();
    expect(parseRestTabState({ activeId: "r-1" })).toBeNull();
    expect(parseRestTabState({ openIds: "r-1", activeId: null })).toBeNull();
    expect(parseRestTabState({ openIds: ["r-1", 7], activeId: null })).toBeNull();
    expect(parseRestTabState({ openIds: ["r-1", ""], activeId: null })).toBeNull();
    expect(parseRestTabState({ openIds: ["r-1"], activeId: 7 })).toBeNull();
    expect(parseRestTabState({ openIds: ["r-1"] })).toBeNull();
  });
});

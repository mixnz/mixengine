import { describe, expect, it } from "vitest";
import { rebadgeTab, restateTab, retitleTab, tabIdAtOffset, type TabInfo } from "./tabs";

const TABS: TabInfo[] = [
  { id: "a", moduleId: "db", title: "Kết nối mới", badges: [] },
  { id: "b", moduleId: "rest", title: "Yêu cầu mới", badges: [] },
];

describe("retitleTab", () => {
  it("hands back the very same array when the title has not moved", () => {
    expect(retitleTab(TABS, "b", "Yêu cầu mới")).toBe(TABS);
  });

  it("hands back the very same array when no tab has that id", () => {
    expect(retitleTab(TABS, "zzz", "gì đó")).toBe(TABS);
  });

  it("renames the one tab and leaves its neighbour untouched", () => {
    const next = retitleTab(TABS, "b", "GET /users");
    expect(next).not.toBe(TABS);
    expect(next[1].title).toBe("GET /users");
    expect(next[0]).toBe(TABS[0]);
  });
});

describe("rebadgeTab", () => {
  it("hands back the very same array when the badges are the same list", () => {
    expect(rebadgeTab(TABS, "a", TABS[0].badges)).toBe(TABS);
  });

  it("hands back the very same array when no tab has that id", () => {
    expect(rebadgeTab(TABS, "zzz", [])).toBe(TABS);
  });

  it("replaces the badges of the one tab", () => {
    const badges = [{ id: "readOnly", icon: null, label: "Chỉ đọc" }];
    const next = rebadgeTab(TABS, "a", badges);
    expect(next).not.toBe(TABS);
    expect(next[0].badges).toBe(badges);
    expect(next[1]).toBe(TABS[1]);
  });
});

describe("restateTab", () => {
  it("hands back the very same array when the state is the same object", () => {
    const state = { savedId: "c-1" };
    const withState = restateTab(TABS, "a", state);
    expect(restateTab(withState, "a", state)).toBe(withState);
  });

  it("hands back the very same array when there was no state and none is given", () => {
    expect(restateTab(TABS, "a", undefined)).toBe(TABS);
  });

  it("hands back the very same array when no tab has that id", () => {
    expect(restateTab(TABS, "zzz", { savedId: "c-1" })).toBe(TABS);
  });

  it("replaces the state of the one tab and leaves its neighbour alone", () => {
    const state = { savedId: "c-1" };
    const next = restateTab(TABS, "a", state);
    expect(next).not.toBe(TABS);
    expect(next[0].state).toBe(state);
    expect(next[1]).toBe(TABS[1]);
  });

  it("forgets a tab's state when handed undefined", () => {
    const withState = restateTab(TABS, "a", { savedId: "c-1" });
    expect(restateTab(withState, "a", undefined)[0].state).toBeUndefined();
  });

  /* Two equal objects are two objects. The bail-out is identity on purpose — see the note at the
     top of `tabs.ts` — and a module that builds a fresh state object every render is the caller
     that has to change, not this. */
  it("does not compare state by value", () => {
    const withState = restateTab(TABS, "a", { savedId: "c-1" });
    expect(restateTab(withState, "a", { savedId: "c-1" })).not.toBe(withState);
  });
});

describe("tabIdAtOffset", () => {
  it("walks one along the strip, in either direction", () => {
    expect(tabIdAtOffset(TABS, "a", 1)).toBe("b");
    expect(tabIdAtOffset(TABS, "b", -1)).toBe("a");
  });

  it("wraps round both ends", () => {
    expect(tabIdAtOffset(TABS, "b", 1)).toBe("a");
    expect(tabIdAtOffset(TABS, "a", -1)).toBe("b");
  });

  it("stays put when there is nowhere else to go", () => {
    expect(tabIdAtOffset([TABS[0]], "a", 1)).toBe("a");
    expect(tabIdAtOffset([], "a", 1)).toBe("a");
  });

  it("stays put on an id the strip does not hold", () => {
    expect(tabIdAtOffset(TABS, "zzz", 1)).toBe("zzz");
  });
});

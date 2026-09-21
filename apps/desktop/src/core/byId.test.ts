import { describe, expect, it } from "vitest";
import { dedupeById, upsertById } from "./byId";

type Row = { id: string; v: number };
const id = (row: Row) => row.id;

describe("upsertById", () => {
  it("appends an id it has not seen", () => {
    expect(upsertById([{ id: "a", v: 1 }], { id: "b", v: 2 }, id)).toEqual([
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ]);
  });

  it("replaces an id it has, where it stands, instead of adding a second", () => {
    const list = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ];
    expect(upsertById(list, { id: "a", v: 9 }, id)).toEqual([
      { id: "a", v: 9 },
      { id: "b", v: 2 },
    ]);
  });
});

describe("dedupeById", () => {
  it("keeps one of each id, at its first place, with its last value", () => {
    const list = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "a", v: 3 },
    ];
    expect(dedupeById(list, id)).toEqual([
      { id: "a", v: 3 },
      { id: "b", v: 2 },
    ]);
  });

  it("hands back the same array when nothing repeats, so a caller can tell", () => {
    const list = [{ id: "a", v: 1 }];
    expect(dedupeById(list, id)).toBe(list);
  });
});

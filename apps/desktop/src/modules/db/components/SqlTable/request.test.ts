import { describe, expect, it } from "vitest";
import {
  fileTable,
  rememberedTable,
  sameRequest,
  type RememberedTable,
  type TableCache,
  type TableRequest,
} from "./request";

const filters: TableRequest["filters"] = [];

function request(overrides: Partial<TableRequest> = {}): TableRequest {
  return {
    connectionId: "c1",
    db: "shop",
    table: "orders",
    page: 0,
    pageSize: 100,
    sort: null,
    filters,
    reloadToken: 0,
    schemaToken: 0,
    ...overrides,
  };
}

describe("sameRequest", () => {
  it("answers a repeat of the same read from what is in hand", () => {
    expect(sameRequest(request(), request())).toBe(true);
  });

  it("owes a read when nothing has been read yet", () => {
    expect(sameRequest(null, request())).toBe(false);
  });

  it.each([
    ["another table", { table: "customers" }],
    ["another database", { db: "warehouse" }],
    ["another connection", { connectionId: "c2" }],
    ["another page", { page: 1 }],
    ["another page size", { pageSize: 500 }],
  ])("owes a read for %s", (_name, overrides) => {
    expect(sameRequest(request(), request(overrides))).toBe(false);
  });

  it("owes a read when the reload button has asked for one", () => {
    expect(sameRequest(request(), request({ reloadToken: 1 }))).toBe(false);
  });

  // A table dropped and made again under the same name is a different table, and the rows read
  // from the one it replaced must never be handed back for it.
  it("owes a read when the database's shape has changed since", () => {
    expect(sameRequest(request(), request({ schemaToken: 1 }))).toBe(false);
  });

  // Both are replaced wholesale rather than edited, so identity is the comparison: applying
  // conditions that spell out the same thing is still the user asking to see them run.
  it("owes a read for conditions that are equal but not the same array", () => {
    expect(sameRequest(request({ filters: [] }), request({ filters: [] }))).toBe(false);
  });

  it("owes a read for an order that is equal but not the same object", () => {
    const sort = { column: "id", desc: true };
    expect(sameRequest(request({ sort }), request({ sort }))).toBe(true);
    expect(sameRequest(request({ sort }), request({ sort: { ...sort } }))).toBe(false);
  });
});

function remembered(overrides: Partial<TableRequest> = {}): RememberedTable {
  return {
    columns: ["id"],
    columnMeta: {},
    primaryKey: ["id"],
    autoIncrementColumn: "id",
    rows: [{ id: 1 }],
    total: 1,
    request: request(overrides),
    scrollTop: 0,
    scrollLeft: 0,
  };
}

describe("rememberedTable", () => {
  const key = "shop :: orders";

  it("hands back what was filed for the shape the database has now", () => {
    const cache: TableCache = new Map([[key, remembered()]]);
    expect(rememberedTable(cache, key, 0)).toBe(cache.get(key));
  });

  it("has nothing for a table never visited", () => {
    expect(rememberedTable(new Map(), key, 0)).toBeUndefined();
  });

  // Emptying the cache when the shape changes does not settle this on its own: the grid on screen
  // holds its own copy of the rows and files them straight back on the way out, under the token
  // they were read with. Reading is where the entry has to be turned down.
  it("has nothing filed before the app last changed the database's shape", () => {
    const cache: TableCache = new Map([[key, remembered()]]);
    expect(rememberedTable(cache, key, 1)).toBeUndefined();
  });
});

describe("fileTable", () => {
  /** Fills the cache with `count` tables, oldest first, named `t0` upwards. */
  function filled(count: number): TableCache {
    const cache: TableCache = new Map();
    for (let i = 0; i < count; i += 1) fileTable(cache, `shop :: t${i}`, remembered());
    return cache;
  }

  it("hands back what was just filed", () => {
    const cache = filled(1);
    expect(rememberedTable(cache, "shop :: t0", 0)).toBeDefined();
  });

  // A page of rows apiece is worth keeping for the tables being worked on and not for the hundred
  // walked past on the way, which is what a session with no ceiling on this would end up holding.
  it("lets the table left longest ago go once it is full", () => {
    const cache = filled(40);
    expect(cache.size).toBe(20);
    expect(cache.has("shop :: t19")).toBe(false);
    expect(cache.has("shop :: t20")).toBe(true);
    expect(cache.has("shop :: t39")).toBe(true);
  });

  // Oldest means last left, not first seen: a table gone back to is at the near end of the queue
  // again, or the two tables someone is moving between would take turns being thrown away.
  it("puts a table filed again at the back of the queue", () => {
    const cache = filled(20);
    fileTable(cache, "shop :: t0", remembered());
    fileTable(cache, "shop :: t20", remembered());
    expect(cache.has("shop :: t0")).toBe(true);
    expect(cache.has("shop :: t1")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { storeHandlers } from "./store";

describe("storeHandlers", () => {
  const seed = { "connections.json": { saved: [{ id: "a" }] } };

  it("opens one resource per file, the same one each time", () => {
    const store = storeHandlers(seed);
    const first = store["plugin:store|load"]({ path: "connections.json" });
    expect(store["plugin:store|load"]({ path: "connections.json" })).toBe(first);
    expect(store["plugin:store|load"]({ path: "other.json" })).not.toBe(first);
  });

  it("answers get as [value, exists], the way the plugin does", () => {
    const store = storeHandlers(seed);
    const rid = store["plugin:store|load"]({ path: "connections.json" });
    expect(store["plugin:store|get"]({ rid, key: "saved" })).toEqual([[{ id: "a" }], true]);
    expect(store["plugin:store|get"]({ rid, key: "missing" })).toEqual([null, false]);
  });

  it("keeps what is set, without writing into the seed", () => {
    const store = storeHandlers(seed);
    const rid = store["plugin:store|load"]({ path: "connections.json" });
    store["plugin:store|set"]({ rid, key: "saved", value: [] });
    expect(store["plugin:store|get"]({ rid, key: "saved" })).toEqual([[], true]);
    expect(seed["connections.json"].saved).toEqual([{ id: "a" }]);
  });

  it("answers an unseeded file as empty rather than failing", () => {
    const store = storeHandlers({});
    const rid = store["plugin:store|load"]({ path: "tool-usage.json" });
    expect(store["plugin:store|keys"]({ rid })).toEqual([]);
    expect(store["plugin:store|save"]({ rid })).toBeNull();
  });
});

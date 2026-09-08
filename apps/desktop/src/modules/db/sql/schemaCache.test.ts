import { describe, expect, it, vi } from "vitest";
import type { SqlSchemaOutline } from "../types";
import type { SqlApi } from "./api";
import { invalidateSchemaOutline, readSchemaOutline } from "./schemaCache";

const outline = (database: string): SqlSchemaOutline => ({ database, tables: [] });

/**
 * An api whose `schemaOutline` is answered by hand, so a read can be held open while something
 * else happens — which is the whole of what this cache has to get right.
 */
function heldApi() {
  const pending: (() => void)[] = [];
  const schemaOutline = vi.fn(
    (_id: string, database: string) =>
      new Promise<SqlSchemaOutline>((resolve) => {
        pending.push(() => resolve(outline(database)));
      }),
  );
  return { api: { schemaOutline } as unknown as SqlApi, calls: schemaOutline, pending };
}

/** A fresh connection id per test: the cache is module state and outlives any one of them. */
let next = 0;
const freshId = () => `conn-${(next += 1)}`;

describe("readSchemaOutline", () => {
  it("goes to the server once and answers from the cache after", async () => {
    const id = freshId();
    const { api, calls, pending } = heldApi();

    const first = readSchemaOutline(api, id, "shop");
    pending[0]();
    await expect(first).resolves.toEqual(outline("shop"));

    await expect(readSchemaOutline(api, id, "shop")).resolves.toEqual(outline("shop"));
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("has two callers asking at once share the one call", async () => {
    const id = freshId();
    const { api, calls, pending } = heldApi();

    const first = readSchemaOutline(api, id, "shop");
    const second = readSchemaOutline(api, id, "shop");
    expect(calls).toHaveBeenCalledTimes(1);

    pending[0]();
    await expect(Promise.all([first, second])).resolves.toEqual([outline("shop"), outline("shop")]);
  });

  it("keeps each connection and database apart", async () => {
    const { api, calls, pending } = heldApi();
    const a = freshId();
    const b = freshId();

    void readSchemaOutline(api, a, "shop");
    void readSchemaOutline(api, a, "blog");
    void readSchemaOutline(api, b, "shop");
    pending.forEach((resolve) => resolve());
    expect(calls).toHaveBeenCalledTimes(3);
  });

  it("answers with a read the invalidation overtook, but does not cache it", async () => {
    // The case the generation counter exists for: a `DROP` lands while a slow read is still in the
    // air. What comes back describes the database as it was *before* the change, so caching it
    // would put the stale copy back under the very key that was just cleared — where nothing
    // would ever clear it again.
    const id = freshId();
    const { api, calls, pending } = heldApi();

    const overtaken = readSchemaOutline(api, id, "shop");
    invalidateSchemaOutline(id, "shop");
    pending[0]();
    // Whoever asked is still owed the best that is known.
    await expect(overtaken).resolves.toEqual(outline("shop"));

    // But the next read goes back to the server rather than being served that answer.
    void readSchemaOutline(api, id, "shop");
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("does not let a finished read clear the slot of the one that replaced it", async () => {
    // The `finally` deletes the in-flight entry only when it is still its own. A blind delete
    // would take the newer read out of the map, and the caller after it would start a third.
    const id = freshId();
    const { api, calls, pending } = heldApi();

    void readSchemaOutline(api, id, "shop");
    invalidateSchemaOutline(id, "shop");
    const second = readSchemaOutline(api, id, "shop");
    expect(calls).toHaveBeenCalledTimes(2);

    // The first read lands now, after the second has taken its place.
    pending[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(readSchemaOutline(api, id, "shop")).toBe(second);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("throws the outline away when the database is invalidated", async () => {
    const id = freshId();
    const { api, calls, pending } = heldApi();

    const first = readSchemaOutline(api, id, "shop");
    pending[0]();
    await first;

    invalidateSchemaOutline(id, "shop");
    void readSchemaOutline(api, id, "shop");
    // An outline that is merely old is worse than none: it completes a column that has been
    // dropped and stays silent about the one just added.
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("leaves the other databases alone when one is invalidated", async () => {
    const id = freshId();
    const { api, calls, pending } = heldApi();

    const shop = readSchemaOutline(api, id, "shop");
    const blog = readSchemaOutline(api, id, "blog");
    pending.forEach((resolve) => resolve());
    await Promise.all([shop, blog]);
    expect(calls).toHaveBeenCalledTimes(2);

    invalidateSchemaOutline(id, "shop");
    void readSchemaOutline(api, id, "blog");
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure, so the next read tries again", async () => {
    const id = freshId();
    const schemaOutline = vi.fn(() => Promise.reject(new Error("no")));
    const api = { schemaOutline } as unknown as SqlApi;

    await expect(readSchemaOutline(api, id, "shop")).rejects.toThrow("no");
    await expect(readSchemaOutline(api, id, "shop")).rejects.toThrow("no");
    expect(schemaOutline).toHaveBeenCalledTimes(2);
  });
});

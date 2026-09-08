import { describe, expect, it, vi } from "vitest";
import { createStore } from "./jsonStore";

/** A read that can be answered when the test says so, so the in-flight window is a place the test
 *  can stand rather than a race it has to win. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

describe("createStore", () => {
  it("answers with the defaults until the read comes back", async () => {
    const gate = deferred<number[]>();
    const store = createStore<number[]>({ defaults: [], load: () => gate.promise });

    expect(store.get()).toEqual([]);
    expect(store.isLoaded()).toBe(false);

    const ready = store.ready();
    gate.settle([1, 2]);
    await ready;

    expect(store.get()).toEqual([1, 2]);
    expect(store.isLoaded()).toBe(true);
  });

  /* The reason the in-flight promise is kept at all: every tab mounting at once asks, and the file
     is read for the first of them. */
  it("reads once however many ask at the same time", async () => {
    const gate = deferred<string[]>();
    const load = vi.fn(() => gate.promise);
    const store = createStore<string[]>({ defaults: [], load });

    const all = Promise.all([store.ready(), store.ready(), store.ready()]);
    gate.settle(["a"]);
    await all;
    await store.ready();

    expect(load).toHaveBeenCalledTimes(1);
  });

  /* A read that failed must not settle the store into "empty for the session" — the next mount is
     the retry, and there is nobody to show an error to in between. */
  it("stays unread after a failed read, so the next asker tries again", async () => {
    const first = deferred<number[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce([7]);
    const store = createStore<number[]>({ defaults: [], load });

    const failed = store.ready();
    first.fail(new Error("no file"));
    await expect(failed).rejects.toThrow("no file");
    expect(store.isLoaded()).toBe(false);

    await store.ready();
    expect(store.get()).toEqual([7]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("tells its listeners on every publish, and stops when they leave", () => {
    const store = createStore<number>({ defaults: 0, load: async () => 0 });
    const heard = vi.fn();
    const stop = store.subscribe(heard);

    store.publish(1);
    store.publish(2);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    store.publish(3);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(store.get()).toBe(3);
  });

  /* On screen first, on disk second. What the user just asked for is already visible while the
     write is still out, and a failed write is still theirs to hear about. */
  it("shows a saved value before it writes it, and reports a write that failed", async () => {
    const written: number[][] = [];
    const store = createStore<number[]>({
      defaults: [],
      load: async () => [],
      persist: async (value) => {
        written.push(value);
        if (value.length > 2) throw new Error("disk full");
      },
    });

    await store.save([1]);
    expect(store.get()).toEqual([1]);
    expect(written).toEqual([[1]]);

    await expect(store.save([1, 2, 3])).rejects.toThrow("disk full");
    // Published all the same: the value is what the app is now showing either way.
    expect(store.get()).toEqual([1, 2, 3]);
  });

  /** A store whose writes go through another module passes no `persist`, and saving is a publish. */
  it("saves without writing when nothing was given to write with", async () => {
    const store = createStore<string>({ defaults: "", load: async () => "" });
    await expect(store.save("x")).resolves.toBeUndefined();
    expect(store.get()).toBe("x");
  });

  /* The difference `remember` exists for. A history whose file could not be read still shows what
     this session sent — but the store must stay unread, or the next write would build the file out
     of a snapshot that never held what was already on disk. */
  it("can show a value without claiming the file was read", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("no file")).mockResolvedValueOnce(["old"]);
    const store = createStore<string[]>({ defaults: [], load });

    await expect(store.ready()).rejects.toThrow("no file");
    store.remember(["this session"]);
    expect(store.get()).toEqual(["this session"]);
    expect(store.isLoaded()).toBe(false);

    // And so the read is still owed, and still happens.
    await store.ready();
    expect(store.get()).toEqual(["old"]);
  });

  /** `useSyncExternalStore` compares references, so a value is replaced and never edited. */
  it("hands back the very value it was given", async () => {
    const value = [{ a: 1 }];
    const store = createStore<{ a: number }[]>({ defaults: [], load: async () => value });
    await store.ready();
    expect(store.get()).toBe(value);
  });
});

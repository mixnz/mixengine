import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";

/**
 * One value on disk, shared by every tab that asks for it.
 *
 * Ten files had written this out for themselves — the snapshot, the `loaded` flag, the in-flight
 * promise, the listener set, `ensureLoaded`, `publish`, `persist` — and two of them said in a
 * comment that the third copy should become this file. There were ten.
 *
 * The shape they all had, and the reasons behind it, are worth keeping in one place:
 *
 * - **Read once, not once per tab.** Each tab reading for itself is a file read per tab, and a
 *   value saved in one tab is unseen in the next until the app restarts. What is one thing on disk
 *   is one thing in memory.
 * - **The whole value is replaced, never edited in place.** `useSyncExternalStore` decides whether
 *   to re-render by comparing this reference with the last one.
 * - **A failed read leaves `loaded` false**, so the next mount tries again rather than settling on
 *   an empty list for the session.
 * - **`loaded` is separate from the value.** An empty list before the read and an empty list
 *   because there is nothing saved look identical, and something has to tell them apart — a tab
 *   restoring what it had open reads "not in the list" as "deleted".
 *
 * What is *not* here is anything about what the value means. A store that merges credentials out
 * of the OS keyring, or migrates an old key on the way in, passes its own `load`; one that writes
 * through another module passes no `persist` at all.
 */
export interface StoreHandle<T> {
  /** For `useSyncExternalStore`. Stable, so it can be passed straight in. */
  subscribe: (listener: () => void) => () => void;
  /** The current value. Stable, and the same reference until something publishes. */
  get: () => T;
  /** Whether the one read has finished. See the note above on why this is not the value itself. */
  isLoaded: () => boolean;
  /** Starts the one read, or joins the one already out. Resolves when there is a value. */
  ready: () => Promise<void>;
  /** Puts a value in front of everyone without writing it. For a writer that persists by itself. */
  publish: (next: T) => void;
  /** The same, but **without** claiming the file has been read.
   *
   *  One case has this, and it is worth the extra word: a store whose read failed, where what the
   *  session has added since is still worth showing but the disk must not be written from it. Told
   *  it was read, the store would never retry — and a later write would build the file out of a
   *  snapshot that never contained what was already on it. */
  remember: (next: T) => void;
  /** Publishes, then writes. Rejects if the write fails — the value is already on screen by then,
   *  which is the right order for anything the user just asked for. */
  save: (next: T) => Promise<void>;
}

export interface StoreOptions<T> {
  /** What `get()` answers before the first read finishes. */
  defaults: T;
  /** The one read. Whatever it resolves to becomes the value. */
  load: () => Promise<T>;
  /** How a value is written back, when this store writes at all. */
  persist?: (value: T) => Promise<void>;
}

export function createStore<T>({ defaults, load, persist }: StoreOptions<T>): StoreHandle<T> {
  let snapshot: T = defaults;
  let loaded = false;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const remember = (next: T) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const publish = (next: T) => {
    loaded = true;
    remember(next);
  };

  const ready = () => {
    if (loaded) return Promise.resolve();
    if (!inFlight) {
      inFlight = load()
        .then(publish)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => snapshot,
    isLoaded: () => loaded,
    ready,
    publish,
    remember,
    save: async (next) => {
      publish(next);
      await persist?.(next);
    },
  };
}

/**
 * The value, and the read that fetches it the first time anyone looks.
 *
 * The read is started from an effect rather than during render: it cannot be awaited here, and a
 * failure has nowhere to go — the list is simply empty and the next mount tries again. Swallowed
 * rather than left to reject, so it does not surface as an unhandled promise.
 */
export function useStore<T>(store: StoreHandle<T>): T {
  useEffect(() => {
    store.ready().catch(() => {});
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Whether the file has been read yet — see `isLoaded`. Does not start the read; something else
 *  on screen is already asking for the value itself. */
export function useStoreLoaded<T>(store: StoreHandle<T>): boolean {
  return useSyncExternalStore(store.subscribe, store.isLoaded);
}

/**
 * `load` and `persist` for the commonest case by far: one key in one JSON file under the app's
 * data directory.
 *
 * The `Store` handle is opened once and shared, because `Store.load` on the same file twice is two
 * handles onto one file.
 */
export function jsonFile<T>(file: string, key: string, fallback: T) {
  let opening: Promise<Store> | null = null;
  const open = () => (opening ??= Store.load(file));

  return {
    load: async (): Promise<T> => (await (await open()).get<T>(key)) ?? fallback,
    persist: async (value: T): Promise<void> => {
      const store = await open();
      await store.set(key, value);
      await store.save();
    },
  };
}

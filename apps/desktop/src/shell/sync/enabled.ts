/**
 * Which collections this machine lends, by their D5 id. **Every one starts off** (D5), and this
 * list is this machine's own: it is not among the preferences that sync, because turning a row on
 * here is a decision about this machine.
 */
const KEY = "mixlab-sync-collections";

/** What this needs of `localStorage`, so a test can hand it a map instead. */
export interface EnabledStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readEnabled(storage: EnabledStorage): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeEnabled(storage: EnabledStorage, ids: Iterable<string>): void {
  storage.setItem(KEY, JSON.stringify([...new Set(ids)].sort()));
}

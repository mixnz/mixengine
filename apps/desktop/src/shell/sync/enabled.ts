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

/** One row on or off; the rest as they were. Returns the set now stored. */
export function setEnabled(storage: EnabledStorage, id: string, on: boolean): Set<string> {
  const ids = readEnabled(storage);
  if (on) ids.add(id);
  else ids.delete(id);
  writeEnabled(storage, ids);
  return readEnabled(storage);
}

/**
 * One row on or off, under D5's two rules for a secret row: it cannot go on before the row it
 * belongs to, and it goes off with that row, staying off when that row comes back. Returns the set
 * now stored; a refused change stores nothing.
 */
export function toggleRow(
  storage: EnabledStorage,
  rows: readonly { id: string; belongsTo?: string }[],
  id: string,
  on: boolean,
): Set<string> {
  const ids = readEnabled(storage);
  if (on) {
    const owner = rows.find((row) => row.id === id)?.belongsTo;
    if (owner !== undefined && !ids.has(owner)) return ids;
    ids.add(id);
  } else {
    ids.delete(id);
    for (const row of rows) if (row.belongsTo === id) ids.delete(row.id);
  }
  writeEnabled(storage, ids);
  return readEnabled(storage);
}

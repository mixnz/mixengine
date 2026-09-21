/**
 * Lists of saved things are keyed by id, and one id is one thing: two rows with the same id draw as
 * one thing selected twice, and deleting either takes both.
 */

/** `item` in place of the row with its id, or at the end when there is none. */
export function upsertById<T>(list: readonly T[], item: T, idOf: (item: T) => string): T[] {
  const id = idOf(item);
  const at = list.findIndex((existing) => idOf(existing) === id);
  if (at === -1) return [...list, item];
  const next = [...list];
  next[at] = item;
  return next;
}

/**
 * One row per id: the first one's place, the last one's value. The same array comes back when no id
 * repeats, so a caller knows whether there is anything to write.
 */
export function dedupeById<T>(list: T[], idOf: (item: T) => string): T[] {
  const last = new Map<string, T>();
  for (const item of list) last.set(idOf(item), item);
  if (last.size === list.length) return list;
  const next: T[] = [];
  for (const item of list) {
    const id = idOf(item);
    const kept = last.get(id);
    if (kept === undefined) continue;
    next.push(kept);
    last.delete(id);
  }
  return next;
}

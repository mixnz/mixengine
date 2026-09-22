/**
 * Edits made here that newer ones from another machine replaced, this run (D4). **Reported, never
 * asked about**: by the time anybody reads this, every machine has already agreed on the survivor.
 * Held in memory because the Settings dialog, which shows it, is not mounted while sync runs.
 */
const counts = new Map<string, number>();
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

export function noteReplaced(collection: string, count: number): void {
  counts.set(collection, (counts.get(collection) ?? 0) + count);
  tell();
}

export function replacedCounts(): ReadonlyMap<string, number> {
  return new Map(counts);
}

/** Dismissed: one collection's notice, or with no argument every one. */
export function clearReplaced(collection?: string): void {
  if (collection === undefined) counts.clear();
  else counts.delete(collection);
  tell();
}

export function onReplacedChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * What every pane that remembers a page of data shares: a way of filing an entry that does not let
 * the cache grow without end.
 *
 * The panes each keep their own cache, of their own shape, and what is worth remembering about a
 * table of rows is not what is worth remembering about a list of documents. What they do have in
 * common is that an entry is a whole page of data, and that a session spent walking a hundred
 * tables or collections would otherwise hold every page it had ever shown for as long as the
 * connection stayed open — which is the sort of thing that is invisible until the machine starts
 * swapping.
 */

/**
 * Files an entry, letting the oldest go once the cache is over `limit`.
 *
 * Oldest by when it was last filed, which for these caches is when the table or collection was
 * last left. A Map hands its keys back in the order they were inserted, and deleting before
 * setting is what moves something come back to to the end of that order — without it, the two
 * things a user is moving between would take turns being thrown away.
 */
export function fileInto<T>(cache: Map<string, T>, key: string, entry: T, limit: number): void {
  cache.delete(key);
  cache.set(key, entry);
  for (const oldest of cache.keys()) {
    if (cache.size <= limit) break;
    cache.delete(oldest);
  }
}

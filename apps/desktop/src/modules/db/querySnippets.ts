import { createStore, jsonFile, useStore } from "../../core/jsonStore";

/**
 * Named queries, saved by hand and offered back by name as the editor is typed in.
 *
 * The difference between this and the history beside it is intent: history is everything that ran,
 * kept automatically and eventually dropped off the end; a snippet is something someone decided was
 * worth keeping and gave a name to. So snippets are never evicted, and they complete — typing the
 * first letters of the name offers the whole query, in the same list the table names come from.
 *
 * Not filed per connection: the queries worth naming tend to be the ones that work anywhere.
 */

export interface QuerySnippet {
  /** What is typed to insert it. Unique, case-insensitively — saving over a name replaces it. */
  name: string;
  sql: string;
}

const store = createStore<QuerySnippet[]>({
  defaults: [],
  ...jsonFile<QuerySnippet[]>("query-snippets.json", "snippets", []),
});

/** Every snippet, in the order they will be offered — by name, so the list reads the same twice. */
export function useQuerySnippets(): QuerySnippet[] {
  return useStore(store);
}

/** Saves under `name`, replacing whatever was there. Unlike the history, a failed write here is
 *  worth knowing about — the user asked for this one — so the promise is handed back. */
export async function saveSnippet(snippet: QuerySnippet): Promise<void> {
  const name = snippet.name.trim();
  if (name === "") return;
  const key = name.toLowerCase();
  const list = [...store.get().filter((s) => s.name.toLowerCase() !== key), { ...snippet, name }].sort(
    (a, b) => a.name.localeCompare(b.name)
  );
  await store.save(list);
}

export async function removeSnippet(name: string): Promise<void> {
  const key = name.toLowerCase();
  await store.save(store.get().filter((s) => s.name.toLowerCase() !== key));
}

import { useEffect, useState } from "react";
import type { SqlApi } from "./api";
import type { SqlSchemaOutline } from "../types";

/**
 * The schema outline the Query tab's completion works from, read once per database and kept.
 *
 * Completion asks for this on every keystroke, so it cannot be a call: it is one read of
 * `information_schema` when a database is first typed against, held here until something changes
 * the shape of that database. Two editors on the same connection and database share the one copy,
 * and two asking at the same moment share the one call.
 *
 * A failed read is not an error anyone is shown. Without an outline, completion still offers
 * keywords and functions — it just stops knowing the table names, which is a quieter thing than a
 * banner over a tab the user is typing in.
 */

const cache = new Map<string, SqlSchemaOutline>();
const inFlight = new Map<string, Promise<SqlSchemaOutline>>();
/** Notified with the key that was thrown away, so the hooks holding it read it again. */
const listeners = new Set<(key: string) => void>();
/**
 * How many times each key has been thrown away.
 *
 * A read takes long enough — a slow `information_schema` on 5.7 with a few thousand tables is the
 * case this whole file exists for — that a `DROP` can land while one is still in the air. What
 * comes back then describes the database as it was *before* the change, and caching it would put
 * the stale copy back under the very key that was just cleared, where nothing would clear it
 * again. So every read remembers the number its key was on, and only writes to the cache if the
 * key is still on it.
 */
const generations = new Map<string, number>();

/** Joined on a character neither half can hold, so no two pairs can collide on one key. */
function cacheKey(connectionId: string, database: string): string {
  return `${connectionId}\u0000${database}`;
}

/**
 * The outline for one connection and database, from the cache when it is there and from the server
 * when it is not — with two callers asking at once sharing the one call.
 *
 * Exported for the tests rather than for anyone else: the hook below is the only caller, but what
 * makes this worth having — that a read overtaken by an invalidation is answered with and then
 * thrown away — cannot be reached through a hook without a DOM to render one in.
 */
export function readSchemaOutline(
  api: SqlApi,
  connectionId: string,
  database: string,
): Promise<SqlSchemaOutline> {
  const key = cacheKey(connectionId, database);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const started = generations.get(key) ?? 0;
  const call: Promise<SqlSchemaOutline> = api
    .schemaOutline(connectionId, database)
    .then((outline) => {
      // Still answered with — whoever asked is owed the best that is known — but kept out of the
      // cache once it has been overtaken. See {@link generations}.
      if ((generations.get(key) ?? 0) === started) cache.set(key, outline);
      return outline;
    })
    .finally(() => {
      // Only when this read is still the one on record. An invalidation clears the slot and starts
      // another, and a blind delete here would take that newer one out with it.
      if (inFlight.get(key) === call) inFlight.delete(key);
    });
  inFlight.set(key, call);
  return call;
}

/**
 * Throws away what is known about a database, so the next read goes back to the server.
 *
 * Called after anything that changes the shape of one — a `CREATE`/`ALTER`/`DROP` run from the
 * Query tab, or the same done through the sidebar. An outline that is merely old is worse than
 * none: it completes a column that has been dropped and stays silent about the one just added.
 *
 * A read already in the air is not cancelled — it cannot be — but it is written off: see
 * {@link generations}.
 */
export function invalidateSchemaOutline(connectionId: string, database: string) {
  const key = cacheKey(connectionId, database);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  cache.delete(key);
  inFlight.delete(key);
  for (const listener of listeners) listener(key);
}

/**
 * The outline for this connection and database, or null while it is being read (or if it could not
 * be). Re-reads itself when {@link invalidateSchemaOutline} names the same pair.
 *
 * `active` is what keeps this off the critical path: the Query tab stays mounted behind the Data
 * and Structure tabs, and reading `information_schema` for a database nobody is writing SQL against
 * is a cost for nothing — on MySQL 5.7 with a few thousand tables, a slow one. Nothing is read
 * until the tab is actually looked at, and what has already been read is kept when it is left.
 */
export function useSchemaOutline(
  api: SqlApi,
  connectionId: string,
  database: string,
  active: boolean
): SqlSchemaOutline | null {
  const [outline, setOutline] = useState<SqlSchemaOutline | null>(null);

  useEffect(() => {
    // Left as it was rather than cleared: the editor is hidden, and clearing would only mean
    // completion briefly forgetting the schema on the way back to a tab that already had it.
    if (!active) return;
    if (database === "") {
      setOutline(null);
      return;
    }
    const key = cacheKey(connectionId, database);
    let cancelled = false;
    /** Which load is the current one. An invalidation starts another while the one it replaced is
     *  still in the air, and that one must not put its answer on screen afterwards — it describes
     *  the database as it was before the change. */
    let attempt = 0;

    function load() {
      attempt += 1;
      const mine = attempt;
      const cached = cache.get(key);
      // Handed over without a render in between, so completion never briefly forgets the schema
      // it already has.
      if (cached) {
        setOutline(cached);
        return;
      }
      setOutline(null);
      readSchemaOutline(api, connectionId, database)
        .then((result) => {
          if (!cancelled && mine === attempt) setOutline(result);
        })
        .catch(() => {
          if (!cancelled && mine === attempt) setOutline(null);
        });
    }

    load();
    const listener = (changed: string) => {
      if (changed === key) load();
    };
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
    // `api` belongs to the connection and so cannot change under a live one, but it is named here
    // rather than left out: it is what the read goes through, and a dependency list that hides that
    // is one refactor away from reading a schema through the wrong engine.
  }, [api, connectionId, database, active]);

  return outline;
}

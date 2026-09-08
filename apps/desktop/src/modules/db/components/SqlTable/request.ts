import type { SqlFilter } from "../../sql/filters";
import { fileInto } from "../../../../core/paneCache";
import type { SqlColumnMeta } from "../../types";

/** Which column the grid is ordered by, and which way. Only ever one at a time: clicking a header
 * replaces this rather than adding to it. `null` is the table's own order, untouched. */
export interface Sort {
  column: string;
  desc: boolean;
}

/** Everything one page of rows is read with — what makes two reads the same read. */
export interface TableRequest {
  connectionId: string;
  db: string;
  table: string;
  page: number;
  pageSize: number;
  sort: Sort | null;
  filters: SqlFilter[];
  reloadToken: number;
  /** Which shape of the database the rows were read from. Moved by the workspace every time this
   *  app changes that shape — a table created, renamed or dropped, a column altered, a dump
   *  restored — so that rows read from the shape before are never mistaken for rows read from the
   *  one on screen now. A name is not a promise: a table dropped and made again under the same
   *  name would otherwise open on the rows of the one it replaced. */
  schemaToken: number;
}

/**
 * Whether the rows read for `loaded` are the rows `wanted` is asking for — which is what says
 * whether coming back to the grid costs a read or nothing at all.
 *
 * `filters` and `sort` are compared by identity rather than by value, because both are replaced
 * wholesale rather than edited: a fresh array is a fresh request even when it says the same thing,
 * and that is what makes Apply re-read on conditions that have not changed. `reloadToken` is what
 * the reload button moves, and it is in here so that a reload is never the one request answered
 * from what is already in hand; `schemaToken` is that same thing for a change the app itself made
 * to the database.
 */
export function sameRequest(loaded: TableRequest | null, wanted: TableRequest): boolean {
  return (
    loaded !== null &&
    loaded.connectionId === wanted.connectionId &&
    loaded.db === wanted.db &&
    loaded.table === wanted.table &&
    loaded.page === wanted.page &&
    loaded.pageSize === wanted.pageSize &&
    loaded.sort === wanted.sort &&
    loaded.filters === wanted.filters &&
    loaded.reloadToken === wanted.reloadToken &&
    loaded.schemaToken === wanted.schemaToken
  );
}

/**
 * One table's grid as it was last left: the page that was read, everything needed to draw it, and
 * where the user was in it.
 *
 * The rows are kept, not only the shape — coming back to a table is meant to be coming back to
 * what was on screen, not to a fresh read of it. That does mean the figures can be behind the
 * server; the reload button, `Ctrl+R` and a change the app made itself are what say otherwise, and
 * they are the only things that do.
 */
export interface RememberedTable {
  columns: string[];
  columnMeta: Record<string, SqlColumnMeta>;
  primaryKey: string[];
  autoIncrementColumn: string | null;
  rows: Record<string, unknown>[];
  total: number;
  /** The read these rows came from — the page, the order, the conditions and the shape of the
   *  database, together. Kept as one thing rather than as loose fields: rows and the filters they
   *  answer must never be put back separately, or the grid would show one table's page under
   *  another table's conditions. */
  request: TableRequest;
  scrollTop: number;
  scrollLeft: number;
}

/** Every table's grid, by the table it belongs to. Held by the workspace rather than by the grid,
 * for the same reason the filter bar's cache is: the grid is unmounted whenever the sidebar has no
 * table selected — changing database does it — and a cache living in there would go with it. */
export type TableCache = Map<string, RememberedTable>;

/**
 * How many tables' grids are kept before the least recently left one is let go.
 *
 * An entry here is a whole page of rows — up to a thousand of them, of whatever width the table
 * happens to have. Twenty is well past however many tables anyone moves between in one piece of
 * work, so the cap is only ever met by the tables nobody is going back to.
 */
const TABLE_CACHE_LIMIT = 20;

/** Files a table's grid away, letting the table left longest ago go once the cache is full. */
export function fileTable(cache: TableCache, key: string, entry: RememberedTable): void {
  fileInto(cache, key, entry, TABLE_CACHE_LIMIT);
}

/**
 * What is remembered for a table, or nothing when there is nothing worth speaking for.
 *
 * An entry read before the app last changed the database's shape is nothing: the columns it holds
 * may since have been altered away, and the name it is filed under may since have been dropped and
 * given to a different table altogether. Emptying the cache at the moment of the change is not
 * enough on its own — the grid on screen is still holding its own copy in state and files it back
 * on the way out — so the check has to be here, where the cache is read.
 */
export function rememberedTable(
  cache: TableCache,
  key: string,
  schemaToken: number,
): RememberedTable | undefined {
  const entry = cache.get(key);
  return entry?.request.schemaToken === schemaToken ? entry : undefined;
}

/**
 * What the backend's `extra` says about a SQLite column, read rather than matched at each call
 * site — the counterpart of `src/modules/db/postgres/columns.ts`.
 *
 * The tokens are written by `extra_tokens` in `src-tauri/src/modules/db/drivers/sqlite.rs`, and the
 * two files are the only ones that need to agree on them.
 */
import type { SqlColumnMeta } from "../types";

/**
 * The one column SQLite fills in for you: an `INTEGER PRIMARY KEY`, which is not a column of its
 * own at all but another name for the row's `rowid`.
 *
 * The shape has to be exact. `BIGINT PRIMARY KEY` or a two-column key are ordinary columns that
 * happen to be the key, and an INSERT still has to give them a value — which is why this reads a
 * token the backend decided rather than testing the type here.
 */
export function isAutoIncrement(meta: SqlColumnMeta): boolean {
  return meta.extra.includes("rowid");
}

/** A column SQLite computes from the others — `GENERATED ALWAYS AS (…)`, stored or virtual. */
export function isGenerated(meta: SqlColumnMeta): boolean {
  return meta.extra.includes("generated");
}

/** A column the engine fills in itself, and that an INSERT therefore must not name at all. */
export function isServerAssigned(meta: SqlColumnMeta): boolean {
  return isAutoIncrement(meta) || isGenerated(meta);
}

/**
 * A column holding bytes rather than text.
 *
 * A guess, and unavoidably so: SQLite stores a storage class per *value*, not per column, so a
 * column declared `TEXT` may hold a blob and one declared `BLOB` may hold text. What is matched
 * here is the declared type, the same thing SQLite's own affinity rules read — a type containing
 * `BLOB`, or the empty type, takes blob affinity. The consequence of guessing wrong is a cell shown
 * as base64 that was text, or the reverse; not a wrong write, since a value is sent back the way it
 * was shown.
 */
export function isBinary(meta: SqlColumnMeta): boolean {
  const type = meta.dataType.toLowerCase().trim();
  return type === "" || type.includes("blob");
}

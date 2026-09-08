/**
 * What the backend's `extra` says about a PostgreSQL column, read rather than matched at each call
 * site — the counterpart of `src/mysql/columns.ts`.
 *
 * The tokens are written by `extra_tokens` in `src-tauri/src/db/postgres.rs`, and the two files are
 * the only ones that need to agree on them.
 */
import type { SqlColumnMeta } from "../types";

/** A column the server numbers itself: an identity column, or the older `serial` spelling of one —
 *  an ordinary integer whose default draws from a sequence. */
export function isAutoIncrement(meta: SqlColumnMeta): boolean {
  return meta.extra.includes("identity") || meta.extra.includes("nextval");
}

/** A column PostgreSQL computes from the others — `GENERATED ALWAYS AS ... STORED`. */
export function isGenerated(meta: SqlColumnMeta): boolean {
  return meta.extra.includes("generated");
}

/** A column the server fills in itself, and that an INSERT therefore must not name at all. */
export function isServerAssigned(meta: SqlColumnMeta): boolean {
  return isAutoIncrement(meta) || isGenerated(meta);
}

/**
 * A column holding bytes rather than text.
 *
 * PostgreSQL has exactly one such type — `bytea` — where MySQL has six, so this is a comparison
 * rather than a suffix match. It is what the backend hands over base64-encoded, bytes having no
 * representation of their own in JSON.
 */
export function isBinary(meta: SqlColumnMeta): boolean {
  return meta.dataType.toLowerCase().trim() === "bytea";
}

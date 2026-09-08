/**
 * What the backend's `extra` says about a SQL Server column, read rather than matched at each call
 * site — the counterpart of `src/modules/db/postgres/columns.ts`.
 *
 * The tokens are written by `extra_tokens` in `src-tauri/src/modules/db/drivers/mssql.rs`, and the
 * two files are the only ones that need to agree on them.
 */
import type { SqlColumnMeta } from "../types";

/** A column the server numbers itself — an IDENTITY column. */
export function isAutoIncrement(meta: SqlColumnMeta): boolean {
  return meta.extra.includes("identity");
}

/** A column SQL Server computes from the others — a computed column, stored or not. */
export function isGenerated(meta: SqlColumnMeta): boolean {
  return meta.extra.includes("generated");
}

/**
 * A column the server fills in itself, and that an INSERT therefore must not name at all.
 *
 * Three kinds here where PostgreSQL has two. A `rowversion` (spelled `timestamp` by older schemas)
 * is neither an identity column nor a computed one, but SQL Server stamps it on every write and
 * refuses any statement that tries to write it — so it belongs in this answer and in neither of the
 * two above.
 */
export function isServerAssigned(meta: SqlColumnMeta): boolean {
  return isAutoIncrement(meta) || isGenerated(meta) || meta.extra.includes("rowversion");
}

/**
 * A column holding bytes rather than text — what the backend hands over base64-encoded, bytes
 * having no representation of their own in JSON.
 *
 * `image` is the deprecated spelling of `varbinary(max)` and still all over older schemas.
 * `rowversion`/`timestamp` is on the list because it *is* eight bytes: it arrives base64 like any
 * other binary, and reading it as text would show the grid mojibake.
 */
export function isBinary(meta: SqlColumnMeta): boolean {
  const base = meta.dataType.split("(")[0].trim().toLowerCase();
  return (
    base === "binary" ||
    base === "varbinary" ||
    base === "image" ||
    base === "rowversion" ||
    base === "timestamp"
  );
}

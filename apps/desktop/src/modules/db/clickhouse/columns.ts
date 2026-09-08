/**
 * What {@link SqlDialect} asks about a ClickHouse column, in v1's read-only shape.
 *
 * `isAutoIncrement`/`isGenerated`/`isServerAssigned` are all always false: v1 never inserts a row,
 * so nothing needs to know which columns an INSERT must leave out. ClickHouse has no engine-filled
 * counter to report anyway — no `AUTO_INCREMENT`, no identity column — and its materialized-column
 * expressions (`ALIAS`/`MATERIALIZED`/`EPHEMERAL`) would be the closest match for "generated" once
 * writing exists to make the distinction matter.
 */
import type { SqlColumnMeta } from "../types";

export function isAutoIncrement(_meta: SqlColumnMeta): boolean {
  return false;
}

export function isGenerated(_meta: SqlColumnMeta): boolean {
  return false;
}

export function isServerAssigned(_meta: SqlColumnMeta): boolean {
  return false;
}

/**
 * A column holding bytes rather than text.
 *
 * ClickHouse has one type for both: `String` is an arbitrary byte string, not a validated UTF-8
 * one, and there is no separate binary type the way MySQL's `BLOB` or PostgreSQL's `bytea` are.
 * Always false — a `String` is shown as the grid's ordinary text, which is right far more often
 * than a value that happens not to be valid UTF-8 is wrong.
 */
export function isBinary(_meta: SqlColumnMeta): boolean {
  return false;
}

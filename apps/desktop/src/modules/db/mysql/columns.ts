/**
 * What `SHOW COLUMNS`' Extra says about a column, read rather than matched at each call site.
 *
 * The strings are MySQL's own and they differ between versions — a generated column is
 * `VIRTUAL GENERATED` or `STORED GENERATED`, and 5.7 leaves Extra empty where 8 fills it in — so
 * every place that has to know "may an INSERT name this column?" asks the same question here.
 */
import type { SqlColumnMeta } from "../types";

/** The column MySQL numbers itself. */
export function isAutoIncrement(meta: SqlColumnMeta): boolean {
  return meta.extra.toLowerCase().includes("auto_increment");
}

/** A column MySQL computes from the others. */
export function isGenerated(meta: SqlColumnMeta): boolean {
  const extra = meta.extra.toLowerCase();
  return extra.includes("virtual generated") || extra.includes("stored generated");
}

/** A column MySQL fills in itself, and that an INSERT therefore must not name at all. */
export function isServerAssigned(meta: SqlColumnMeta): boolean {
  return isAutoIncrement(meta) || isGenerated(meta);
}

/**
 * A column holding bytes rather than text — `binary`, `varbinary`, and the four blob types.
 *
 * These are the columns the backend hands over base64-encoded, since bytes have no representation
 * of their own in JSON, and so the ones whose values cannot be written back out as the text they
 * arrive as. The length is cut off first: the declared type is `binary(16)`, not `binary`, and
 * nothing else MySQL declares ends in either word.
 */
export function isBinary(meta: SqlColumnMeta): boolean {
  const type = meta.dataType.toLowerCase().split("(")[0].trim();
  return type.endsWith("binary") || type.endsWith("blob");
}

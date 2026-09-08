import { useEffect, useRef, useState } from "react";
import Button from "../../../../components/Button";
import { PlusIcon, TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { errorMessage } from "../../../../core/errors";
import { useSqlDialect } from "../../sql/context";
import type { SqlDialect } from "../../sql/dialect";
import type { SqlColumnMeta } from "../../types";
import styles from "./InsertRowsDialog.module.css";
import Modal from "../../../../components/Modal";

/** One cell of a row waiting to be inserted. `isNull` is a mode rather than a value: writing SQL
 * NULL and writing the empty string are different things, and text alone can't tell them apart. */
interface DraftCell {
  text: string;
  isNull: boolean;
}

type DraftRow = Record<string, DraftCell>;

interface Props {
  table: string;
  /** The table's columns, in table order. */
  columns: string[];
  columnMeta: Record<string, SqlColumnMeta>;
  /** Rows to seed the form with, one draft row each — the selected rows, for a clone. Left out
   *  (or empty), the form opens on a single blank row. */
  seedRows?: Record<string, unknown>[];
  onCancel: () => void;
  /** Rejects with the reason the insert failed: the dialog then shows it and stays open. The
   *  caller is what closes the dialog, once this resolves. */
  onSubmit: (rows: Record<string, string | null>[]) => Promise<void>;
}

/** A default written as an expression rather than a literal (`CURRENT_TIMESTAMP`, `(uuid())`).
 * It cannot be prefilled as text — sent as a string it would be written out literally — so the
 * column is left out of the INSERT and shows its expression as a hint instead. */
function isExpressionDefault(meta: SqlColumnMeta): boolean {
  // MySQL 8 flags it in Extra; 5.7 leaves Extra empty and only reports the expression itself.
  if (meta.extra.toUpperCase().includes("DEFAULT_GENERATED")) return true;
  return /^current_timestamp/i.test(meta.defaultValue ?? "");
}

function hasDefault(meta: SqlColumnMeta): boolean {
  return meta.defaultValue !== null || isExpressionDefault(meta);
}

/** Types where the empty string is a value in its own right, so an empty cell is a plausible
 * thing to mean rather than one the user forgot to fill in. */
function isTextLikeType(dataType: string): boolean {
  const type = dataType.toLowerCase();
  return ["char", "text", "blob", "binary", "json", "enum", "set"].some((k) => type.includes(k));
}

/** How a column starts out on a blank row: at its default where it has one, at NULL where that
 * is what it would fall back to, and empty otherwise. */
function blankCell(dialect: SqlDialect, meta: SqlColumnMeta): DraftCell {
  // Empty is what keeps a column out of the INSERT, which is the only way MySQL gets to fill
  // in the ones it computes for itself.
  if (dialect.isServerAssigned(meta) || isExpressionDefault(meta)) return { text: "", isNull: false };
  if (meta.defaultValue !== null) return { text: meta.defaultValue, isNull: false };
  if (meta.nullable) return { text: "", isNull: true };
  return { text: "", isNull: false };
}

function cellFromExisting(dialect: SqlDialect, meta: SqlColumnMeta, raw: unknown): DraftCell {
  // A clone gets its own id and its own computed values rather than the original's.
  if (dialect.isServerAssigned(meta)) return blankCell(dialect, meta);
  if (raw === null || raw === undefined) return { text: "", isNull: true };
  return { text: typeof raw === "object" ? JSON.stringify(raw) : String(raw), isNull: false };
}

function buildRow(
  dialect: SqlDialect,
  columns: string[],
  columnMeta: Record<string, SqlColumnMeta>,
  source: Record<string, unknown> | null,
): DraftRow {
  const row: DraftRow = {};
  for (const c of columns) {
    const meta = columnMeta[c];
    if (!meta) continue;
    row[c] = source ? cellFromExisting(dialect, meta, source[c]) : blankCell(dialect, meta);
  }
  return row;
}

/** Marks one cell of the form. The separator is a character no column name can contain, so a
 * name with a colon in it can't collide with another cell's key. */
function cellKey(rowIndex: number, column: string): string {
  return `${rowIndex}${column}`;
}

/**
 * A form for writing one or more new rows into a table, laid out as the table itself: a header
 * naming each column and its type, and one form row per record to insert.
 *
 * The dialog never closes itself on failure — the caller closes it once {@link Props.onSubmit}
 * resolves, so a rejected insert leaves the typed values on screen with the reason above them.
 */
function InsertRowsDialog({ table, columns, columnMeta, seedRows, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const dialect = useSqlDialect();
  const sources = seedRows && seedRows.length > 0 ? seedRows : null;
  const cloning = sources !== null;
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() =>
    sources
      ? sources.map((source) => buildRow(dialect, columns, columnMeta, source))
      : [buildRow(dialect, columns, columnMeta, null)],
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [invalidCells, setInvalidCells] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const firstEditableColumn = columns.find((c) => {
    const meta = columnMeta[c];
    return meta !== undefined && !dialect.isServerAssigned(meta);
  });

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  function updateCell(rowIndex: number, column: string, next: DraftCell) {
    setDraftRows((prev) => prev.map((row, i) => (i === rowIndex ? { ...row, [column]: next } : row)));
    setInvalidCells((prev) => {
      const key = cellKey(rowIndex, column);
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  /** Adding or removing a row renumbers everything below it, which the recorded errors are
   * pinned to — so they are dropped rather than left pointing at the wrong cells. */
  function clearErrors() {
    setErrors([]);
    setInvalidCells(new Set());
  }

  function addRow() {
    setDraftRows((prev) => [...prev, buildRow(dialect, columns, columnMeta, null)]);
    clearErrors();
  }

  function removeRow(rowIndex: number) {
    setDraftRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== rowIndex) : prev));
    clearErrors();
  }

  /** What the row means as an INSERT: an explicit NULL, the text typed, or — for a cell left
   * empty on a column that has something to fall back to — nothing at all, so that the column
   * is left out of the statement and its default applies. */
  function toPayload(row: DraftRow): Record<string, string | null> {
    const payload: Record<string, string | null> = {};
    for (const c of columns) {
      const meta = columnMeta[c];
      const cell = row[c];
      if (!meta || !cell || dialect.isServerAssigned(meta)) continue;
      if (cell.isNull) {
        payload[c] = null;
        continue;
      }
      if (cell.text === "" && hasDefault(meta)) continue;
      payload[c] = cell.text;
    }
    return payload;
  }

  function validate(): { messages: string[]; invalid: Set<string> } {
    const messages: string[] = [];
    const invalid = new Set<string>();
    draftRows.forEach((row, i) => {
      for (const c of columns) {
        const meta = columnMeta[c];
        const cell = row[c];
        if (!meta || !cell || dialect.isServerAssigned(meta)) continue;
        if (cell.isNull && !meta.nullable) {
          messages.push(t("insertRows.errorNotNull", { n: i + 1, column: c }));
          invalid.add(cellKey(i, c));
          continue;
        }
        // An empty cell means "fall back to the default"; a NOT NULL column with no default has
        // nothing to fall back to, so the cell is simply missing a value — except on the types
        // where the empty string is one.
        if (
          !cell.isNull &&
          cell.text === "" &&
          !meta.nullable &&
          !hasDefault(meta) &&
          !isTextLikeType(meta.dataType)
        ) {
          messages.push(t("insertRows.errorRequired", { n: i + 1, column: c }));
          invalid.add(cellKey(i, c));
        }
      }
    });
    return { messages, invalid };
  }

  async function submit() {
    const { messages, invalid } = validate();
    setInvalidCells(invalid);
    setErrors(messages);
    if (messages.length > 0) return;
    setSaving(true);
    try {
      await onSubmit(draftRows.map(toPayload));
    } catch (e) {
      setErrors([errorMessage(t, e)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={table}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <div className={styles.header}>
            <h3 className={styles.title}>
              {t(cloning ? "insertRows.cloneTitle" : "insertRows.title", { table })}
            </h3>
            <p className={styles.note}>{t("insertRows.transactionNote")}</p>
          </div>

          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <thead>
                <tr>
                  <th className={styles.rowNumber} />
                  {columns.map((c) => {
                    const meta = columnMeta[c];
                    return (
                      <th key={c}>
                        <span className={styles.columnName}>
                          {c}
                          {meta && !meta.nullable && (
                            <span className={styles.requiredMark} title={t("insertRows.notNullMarker")}>
                              *
                            </span>
                          )}
                        </span>
                        <span className={styles.columnType}>{meta?.dataType ?? ""}</span>
                      </th>
                    );
                  })}
                  <th className={styles.rowActions} />
                </tr>
              </thead>
              <tbody>
                {draftRows.map((row, i) => (
                  <tr key={i}>
                    <td className={styles.rowNumber}>{i + 1}</td>
                    {columns.map((c) => {
                      const meta = columnMeta[c];
                      const cell = row[c];
                      if (!meta || !cell) return <td key={c} />;
                      if (dialect.isServerAssigned(meta)) {
                        const auto = dialect.isAutoIncrement(meta);
                        return (
                          <td key={c}>
                            <span
                              className={styles.serverAssigned}
                              title={t(auto ? "insertRows.autoTooltip" : "insertRows.generatedTooltip")}
                            >
                              {t(auto ? "insertRows.autoValue" : "insertRows.generatedValue")}
                            </span>
                          </td>
                        );
                      }
                      const invalid = invalidCells.has(cellKey(i, c));
                      const defaultHint = hasDefault(meta) ? (meta.defaultValue ?? "") : "";
                      return (
                        <td key={c}>
                          <div className={styles.cell}>
                            <input
                              ref={i === 0 && c === firstEditableColumn ? firstInputRef : undefined}
                              type="text"
                              className={`${styles.cellInput}${invalid ? ` ${styles.cellInvalid}` : ""}`}
                              value={cell.isNull ? "" : cell.text}
                              placeholder={cell.isNull ? "NULL" : defaultHint}
                              title={
                                hasDefault(meta)
                                  ? t("insertRows.defaultTooltip", { value: defaultHint })
                                  : undefined
                              }
                              disabled={cell.isNull || saving}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              onChange={(e) => updateCell(i, c, { text: e.target.value, isNull: false })}
                            />
                            <button
                              type="button"
                              className={`${styles.nullToggle}${cell.isNull ? ` ${styles.nullOn}` : ""}`}
                              // A NOT NULL column keeps the button, disabled: that it cannot be
                              // pressed is what shows the constraint, cell by cell.
                              disabled={!meta.nullable || saving}
                              title={
                                meta.nullable
                                  ? t(cell.isNull ? "insertRows.unsetNull" : "insertRows.setNull")
                                  : t("insertRows.notNullTooltip", { column: c })
                              }
                              onClick={() => updateCell(i, c, { text: cell.text, isNull: !cell.isNull })}
                            >
                              NULL
                            </button>
                          </div>
                        </td>
                      );
                    })}
                    <td className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.removeRow}
                        title={t("insertRows.removeRow")}
                        aria-label={t("insertRows.removeRow")}
                        disabled={draftRows.length === 1 || saving}
                        onClick={() => removeRow(i)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.toolbar}>
            <Button size="small" onClick={addRow} disabled={saving}>
              <PlusIcon size={12} /> {t("insertRows.addRow")}
            </Button>
          </div>

          {errors.length > 0 && (
            <div className={styles.errors} role="alert">
              {errors.map((message, i) => (
                <p key={i}>{message}</p>
              ))}
            </div>
          )}

          <div className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button size="large" variant="primary" onClick={() => void submit()} disabled={saving}>
              {saving ? t("insertRows.inserting") : t("insertRows.insert", { n: draftRows.length })}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default InsertRowsDialog;

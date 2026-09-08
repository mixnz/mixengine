import { useEffect, useRef, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { MinusIcon, PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { errorMessage } from "../../../../core/errors";
import Modal from "../../../../components/Modal";
import styles from "./OrderByDialog.module.css";

interface DraftColumn {
  /** Distinguishes this row from the others while the list is being edited. */
  id: number;
  name: string;
}

let nextId = 0;

/**
 * The Confirm button stays locked until this is true: an exact, trimmed match of the table's own
 * name, and at least one column chosen. The highest-friction gate anywhere in this app — the
 * operation copies the whole table and, once the copy has started, cannot be undone by this dialog.
 * See the ClickHouse index DDL design doc's D6.
 */
export function confirmEnabled(typed: string, table: string, columnCount: number): boolean {
  return columnCount > 0 && typed.trim() === table;
}

interface Props {
  table: string;
  /** Every column in table order, for the picker rows. */
  columns: string[];
  /** The sorting key's current columns, in order — what the dialog starts from. */
  current: string[];
  /** A best-effort `count()`, or `null` when it could not be read — the warning omits the number
   *  rather than blocking the dialog over it. */
  rowCount: number | null;
  onCancel: () => void;
  /** Rejects with the reason the rebuild failed: the dialog then shows it and stays open. */
  onSubmit: (columns: string[]) => Promise<void>;
}

function OrderByDialog({ table, columns, current, rowCount, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftColumn[]>(() =>
    (current.length > 0 ? current : [columns[0] ?? ""]).map((name) => ({ id: nextId++, name })),
  );
  const [typed, setTyped] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const typedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    typedRef.current?.focus();
  }, []);

  const columnOptions = columns.map((c) => ({ value: c, label: c }));

  function updateColumn(id: number, name: string) {
    setDraft((prev) => prev.map((row) => (row.id === id ? { ...row, name } : row)));
    setErrors([]);
  }

  const canConfirm = confirmEnabled(typed, table, draft.length) && !saving;

  async function submit() {
    const names = draft.map((row) => row.name).filter((name) => name !== "");
    const messages: string[] = [];
    if (names.length === 0) messages.push(t("orderByDialog.errorColumns"));
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) messages.push(t("orderByDialog.errorDuplicateColumn", { column: name }));
      seen.add(name);
    }
    setErrors(messages);
    if (messages.length > 0) return;
    setSaving(true);
    try {
      await onSubmit(names);
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
            <h3 className={styles.title}>{t("orderByDialog.title", { table })}</h3>
            <p className={styles.note}>
              {rowCount === null
                ? t("orderByDialog.warning")
                : t("orderByDialog.warningWithCount", { count: rowCount })}
            </p>
          </div>

          <div className={styles.columns}>
            <span className={styles.columnsLabel}>{t("orderByDialog.columns")}</span>
            {draft.map((row) => (
              <div key={row.id} className={styles.columnRow}>
                <Select
                  value={row.name}
                  size="small"
                  className={styles.columnSelect}
                  options={columnOptions}
                  ariaLabel={t("orderByDialog.column")}
                  disabled={saving}
                  searchable
                  onChange={(next) => updateColumn(row.id, next)}
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t("orderByDialog.removeColumn")}
                  title={t("orderByDialog.removeColumn")}
                  disabled={saving || draft.length === 1}
                  onClick={() => {
                    setDraft((prev) => prev.filter((r) => r.id !== row.id));
                    setErrors([]);
                  }}
                >
                  <MinusIcon size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t("orderByDialog.addColumn")}
              title={t("orderByDialog.addColumn")}
              disabled={saving || columns.length === 0}
              onClick={() => {
                setDraft((prev) => [...prev, { id: nextId++, name: columns[0] ?? "" }]);
                setErrors([]);
              }}
            >
              <PlusIcon size={14} />
            </button>
          </div>

          <label className={styles.field}>
            {t("orderByDialog.confirmLabel", { table })}
            <Input
              ref={typedRef}
              size="normal"
              value={typed}
              disabled={saving}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>

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
            <Button
              size="large"
              variant="default"
              className={styles.danger}
              onClick={() => void submit()}
              disabled={!canConfirm}
            >
              {saving ? t("orderByDialog.saving") : t("orderByDialog.submit")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default OrderByDialog;

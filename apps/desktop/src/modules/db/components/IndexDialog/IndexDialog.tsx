import { useEffect, useRef, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { MinusIcon, PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { errorMessage } from "../../../../core/errors";
import type { SqlIndexKind, SqlIndexSpec, SqlTableIndex } from "../../types";
import { useSqlDialect } from "../../sql/context";
import styles from "./IndexDialog.module.css";
import Modal from "../../../../components/Modal";

/** One column of the index being built. `prefixLength` is text rather than a number so a
 * half-typed value doesn't have to mean anything yet. */
interface DraftColumn {
  /** Distinguishes this row from the others while the list is being edited — two rows may well
   * name the same column before one of them is changed. */
  id: number;
  name: string;
  prefixLength: string;
}

/** Which kind of index this is, read back off one the server reported: the kind is spread across
 * three of its fields, and the dialog needs it as the single choice it is on screen.
 *
 * `FULLTEXT` and `SPATIAL` are MySQL's, and never come back from PostgreSQL — where the access
 * methods that would be nearest to them are index *methods* rather than kinds. So the same reading
 * serves either engine. */
export function indexKind(index: SqlTableIndex): SqlIndexKind {
  if (index.primary) return "primary";
  const type = index.indexType.toUpperCase();
  if (type === "FULLTEXT") return "fulltext";
  if (type === "SPATIAL") return "spatial";
  return index.unique ? "unique" : "index";
}

/** The kinds that have a choice of access method. A primary key never does — either engine builds
 * it the one way — and MySQL's `FULLTEXT` and `SPATIAL` each have exactly one structure, which is
 * why it rejects a `USING` clause on them. */
function takesMethod(kind: SqlIndexKind): boolean {
  return kind === "index" || kind === "unique";
}

let nextId = 0;

function draftColumns(index: SqlTableIndex | undefined, columns: string[]): DraftColumn[] {
  if (!index) {
    return [{ id: nextId++, name: columns[0] ?? "", prefixLength: "" }];
  }
  return index.columns.map((column) => ({
    id: nextId++,
    // A functional index has no column name; such an index is not offered for editing, so this
    // only ever stands in for one the table no longer has.
    name: column.name ?? "",
    prefixLength: column.prefixLength === null ? "" : String(column.prefixLength),
  }));
}

interface Props {
  table: string;
  /** The columns available to index, in table order. */
  columns: string[];
  /** The index being replaced, or left out to add a new one. */
  index?: SqlTableIndex;
  onCancel: () => void;
  /** Rejects with the reason the ALTER failed: the dialog then shows it and stays open with the
   *  typed values still in it. The caller is what closes the dialog, once this resolves. */
  onSubmit: (spec: SqlIndexSpec) => Promise<void>;
}

/**
 * The form behind both halves of an index's life: adding one, and replacing one that exists.
 * MySQL cannot alter an index in place, so an edit is a drop and a rebuild — the note in the
 * dialog says so, since that is a heavier operation than the form makes it look.
 */
function IndexDialog({ table, columns, index, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const { editing: offers } = useSqlDialect();
  const editing = index !== undefined;
  const [name, setName] = useState(index?.name ?? "");
  const [kind, setKind] = useState<SqlIndexKind>(index ? indexKind(index) : "index");
  const [method, setMethod] = useState(() => {
    const type = index?.indexType.toUpperCase() ?? "";
    // Only a method the picker offers: an index reported as something the list has no entry for
    // would otherwise leave the trigger blank and be rebuilt as something else on save.
    return offers.indexMethods.includes(type) ? type : "";
  });
  const [draft, setDraft] = useState<DraftColumn[]>(() => draftColumns(index, columns));
  const [comment, setComment] = useState(index?.comment ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  function updateColumn(id: number, changes: Partial<DraftColumn>) {
    setDraft((prev) => prev.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    setErrors([]);
  }

  const columnOptions = columns.map((c) => ({ value: c, label: c }));
  const KIND_LABELS: Record<SqlIndexKind, string> = {
    index: t("indexDialog.kindIndex"),
    unique: t("indexDialog.kindUnique"),
    primary: t("indexDialog.kindPrimary"),
    fulltext: t("indexDialog.kindFulltext"),
    spatial: t("indexDialog.kindSpatial"),
  };
  const kindOptions = offers.indexKinds.map((value) => ({ value, label: KIND_LABELS[value] }));
  const methodOptions = [
    { value: "", label: t("indexDialog.methodDefault") },
    ...offers.indexMethods.map((value) => ({ value, label: value })),
  ];
  /** What a primary key is called, where the engine fixes it. Null leaves the box open, since
   *  PostgreSQL names the constraint behind a primary key like any other. */
  const fixedName = kind === "primary" ? offers.primaryKeyName : null;

  function toSpec(): SqlIndexSpec {
    return {
      name: name.trim(),
      kind,
      indexType: takesMethod(kind) && method !== "" ? method : null,
      columns: draft
        .filter((row) => row.name !== "")
        .map((row) => {
          const prefix = Number.parseInt(row.prefixLength, 10);
          return {
            name: row.name,
            prefixLength: Number.isFinite(prefix) && prefix > 0 ? prefix : null,
          };
        }),
      comment: comment.trim(),
    };
  }

  async function submit() {
    const spec = toSpec();
    const messages: string[] = [];
    if (spec.columns.length === 0) messages.push(t("indexDialog.errorColumns"));
    const seen = new Set<string>();
    for (const column of spec.columns) {
      if (seen.has(column.name)) {
        messages.push(t("indexDialog.errorDuplicateColumn", { column: column.name }));
      }
      seen.add(column.name);
    }
    setErrors(messages);
    if (messages.length > 0) return;
    setSaving(true);
    try {
      await onSubmit(spec);
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
              {editing
                ? t("indexDialog.editTitle", { index: index.name })
                : t("indexDialog.addTitle", { table })}
            </h3>
            {editing && <p className={styles.note}>{t("indexDialog.replaceNote")}</p>}
          </div>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("indexDialog.name")}
              <Input
                ref={nameRef}
                size="normal"
                value={fixedName ?? name}
                placeholder={t("indexDialog.namePlaceholder")}
                // On MySQL a primary key is always called PRIMARY, so there is nothing to type.
                disabled={saving || fixedName !== null}
                title={fixedName !== null ? t("indexDialog.nameFixed") : undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              {t("indexDialog.kind")}
              <Select
                value={kind}
                size="normal"
                options={kindOptions}
                ariaLabel={t("indexDialog.kind")}
                disabled={saving}
                onChange={(next) => {
                  setKind(next);
                  setErrors([]);
                }}
              />
            </label>

            <label className={styles.field}>
              {t("indexDialog.method")}
              <Select
                value={method}
                size="normal"
                options={methodOptions}
                ariaLabel={t("indexDialog.method")}
                disabled={saving || !takesMethod(kind)}
                onChange={setMethod}
              />
            </label>

            <label className={styles.field}>
              {t("indexDialog.comment")}
              <Input
                size="normal"
                value={comment}
                disabled={saving}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </div>

          <div className={styles.columns}>
            <span className={styles.columnsLabel}>{t("indexDialog.columns")}</span>
            {draft.map((row) => (
              <div key={row.id} className={styles.columnRow}>
                <Select
                  value={row.name}
                  size="small"
                  className={styles.columnSelect}
                  options={columnOptions}
                  ariaLabel={t("indexDialog.column")}
                  disabled={saving}
                  searchable
                  onChange={(next) => updateColumn(row.id, { name: next })}
                />
                {/* PostgreSQL indexes a whole value: there is no prefix to ask for. */}
                {offers.indexPrefix && (
                  <Input
                    size="small"
                    className={styles.prefixInput}
                    value={row.prefixLength}
                    placeholder={t("indexDialog.prefixPlaceholder")}
                    aria-label={t("indexDialog.prefixLength")}
                    title={t("indexDialog.prefixTooltip")}
                    inputMode="numeric"
                    disabled={saving}
                    onChange={(e) => updateColumn(row.id, { prefixLength: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t("indexDialog.removeColumn")}
                  title={t("indexDialog.removeColumn")}
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
              aria-label={t("indexDialog.addColumn")}
              title={t("indexDialog.addColumn")}
              disabled={saving || columns.length === 0}
              onClick={() => {
                setDraft((prev) => [
                  ...prev,
                  { id: nextId++, name: columns[0] ?? "", prefixLength: "" },
                ]);
                setErrors([]);
              }}
            >
              <PlusIcon size={14} />
            </button>
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
              {saving
                ? t("indexDialog.saving")
                : t(editing ? "indexDialog.submitEdit" : "indexDialog.submitAdd")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default IndexDialog;

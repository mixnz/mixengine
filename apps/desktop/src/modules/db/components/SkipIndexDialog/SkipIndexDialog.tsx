import { useEffect, useRef, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import { errorMessage } from "../../../../core/errors";
import type { SqlSkipIndex, SqlSkipIndexSpec } from "../../types";
import { SKIP_INDEX_TYPES, defaultArgs, skipIndexType } from "../../clickhouse/skipIndexTypes";
import Modal from "../../../../components/Modal";
import styles from "./SkipIndexDialog.module.css";

/** The argument labels to show for one skip index: the whitelist's own when the TYPE is known and
 *  the argument count matches it, or a generic "argument N" otherwise — an index created outside
 *  this app can be any TYPE ClickHouse supports, or (rarely) drift from the whitelist's own count,
 *  and the dialog still has to show its arguments as something rather than crash. */
export function argLabels(typeName: string, argCount: number): string[] {
  const known = skipIndexType(typeName);
  if (known && known.args.length === argCount) {
    return known.args.map((a) => a.label);
  }
  return Array.from({ length: argCount }, (_, i) => `argument ${i + 1}`);
}

interface Props {
  table: string;
  /** The skip index being replaced, or left out to add a new one. */
  index?: SqlSkipIndex;
  onCancel: () => void;
  /** Rejects with the reason the ALTER failed: the dialog then shows it and stays open with the
   *  typed values still in it. */
  onSubmit: (spec: SqlSkipIndexSpec) => Promise<void>;
}

function SkipIndexDialog({ table, index, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const editing = index !== undefined;
  const [name, setName] = useState(index?.name ?? "");
  const [expr, setExpr] = useState(index?.expr ?? "");
  const [typeName, setTypeName] = useState(index?.indexType ?? SKIP_INDEX_TYPES[0].name);
  const [args, setArgs] = useState<string[]>(
    () => index?.args ?? defaultArgs(SKIP_INDEX_TYPES[0]),
  );
  const [granularity, setGranularity] = useState(String(index?.granularity ?? 1));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const typeOptions = SKIP_INDEX_TYPES.map((type) => ({ value: type.name, label: type.name }));
  const labels = argLabels(typeName, args.length);

  function chooseType(next: string) {
    setTypeName(next);
    const type = skipIndexType(next);
    setArgs(type ? defaultArgs(type) : []);
    setErrors([]);
  }

  function updateArg(i: number, value: string) {
    setArgs((prev) => prev.map((a, j) => (j === i ? value : a)));
    setErrors([]);
  }

  function toSpec(): SqlSkipIndexSpec {
    return {
      name: name.trim(),
      expr: expr.trim(),
      indexType: typeName,
      args: args.map((a) => a.trim()),
      granularity: Number.parseInt(granularity, 10) || 1,
    };
  }

  async function submit() {
    const spec = toSpec();
    const messages: string[] = [];
    if (spec.name === "") messages.push(t("skipIndexDialog.errorName"));
    if (spec.expr === "") messages.push(t("skipIndexDialog.errorExpr"));
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
                ? t("skipIndexDialog.editTitle", { index: index.name })
                : t("skipIndexDialog.addTitle", { table })}
            </h3>
            <p className={styles.note}>{t("skipIndexDialog.granularityHint")}</p>
          </div>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("skipIndexDialog.name")}
              <Input
                ref={nameRef}
                size="normal"
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              {t("skipIndexDialog.expr")}
              <Input
                size="normal"
                value={expr}
                placeholder={t("skipIndexDialog.exprPlaceholder")}
                disabled={saving}
                onChange={(e) => setExpr(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              {t("skipIndexDialog.type")}
              <Select
                value={typeName}
                size="normal"
                options={typeOptions}
                ariaLabel={t("skipIndexDialog.type")}
                disabled={saving}
                onChange={chooseType}
              />
            </label>

            <label className={styles.field}>
              {t("skipIndexDialog.granularity")}
              <Input
                size="normal"
                value={granularity}
                inputMode="numeric"
                disabled={saving}
                onChange={(e) => setGranularity(e.target.value)}
              />
            </label>

            {args.map((value, i) => (
              <label key={i} className={styles.field}>
                {labels[i]}
                <Input
                  size="normal"
                  value={value}
                  disabled={saving}
                  onChange={(e) => updateArg(i, e.target.value)}
                />
              </label>
            ))}
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
                ? t("skipIndexDialog.saving")
                : t(editing ? "skipIndexDialog.submitEdit" : "skipIndexDialog.submitAdd")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default SkipIndexDialog;

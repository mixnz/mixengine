import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { pickFile } from "../../api";
import { useDraftFocus } from "../../draftFocus";
import { fileName } from "../../format";
import type { MultipartField } from "../../types";
import styles from "./MultipartTable.module.css";

interface Props {
  rows: MultipartField[];
  onChange: (rows: MultipartField[]) => void;
}

/** What a row is sending. `file` is the presence of the field, not its contents: a row with
 *  `file: ""` is one whose file has not been picked yet. */
type PartKind = "text" | "file";

/**
 * The multipart body's table: the Params table with one more column.
 *
 * A part is either text or a file, and the column that says which is what makes the value cell an
 * input or a picker. Everything else — the empty row at the foot that adds a row when typed into,
 * the tick that parks a row without losing it — works as it does in the other table.
 */
function MultipartTable({ rows, onChange }: Props) {
  const { t } = useTranslation();
  const { bind, owe } = useDraftFocus();

  function update(id: string, patch: Partial<MultipartField>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function append(column: "key" | "value", text: string) {
    const id = crypto.randomUUID();
    owe(`${id}:${column}`);
    onChange([...rows, { id, enabled: true, key: "", value: "", [column]: text }]);
  }

  /** The picker, and nothing at all when it is dismissed — the row keeps the file it had. */
  async function choose(id: string) {
    const path = await pickFile();
    if (path !== null) update(id, { file: path });
  }

  const kindOptions = [
    { value: "text" as const, label: t("rest.partText") },
    { value: "file" as const, label: t("rest.partFile") },
  ];

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span />
        <span>{t("rest.keyColumn")}</span>
        <span>{t("rest.partKind")}</span>
        <span>{t("rest.valueColumn")}</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={styles.row}>
          <input
            type="checkbox"
            checked={row.enabled}
            aria-label={t("rest.rowEnabled")}
            title={t("rest.rowEnabled")}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
          />
          <Input
            ref={bind(`${row.id}:key`)}
            size="small"
            value={row.key}
            aria-label={t("rest.keyColumn")}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <Select<PartKind>
            size="small"
            value={row.file === undefined ? "text" : "file"}
            ariaLabel={t("rest.partKind")}
            options={kindOptions}
            /* Leaving File drops the path and leaves the text that was typed before it; arriving
               sets an empty path, which is a row saying "a file, not chosen yet". */
            onChange={(kind) => update(row.id, { file: kind === "file" ? "" : undefined })}
          />
          {row.file === undefined ? (
            <Input
              ref={bind(`${row.id}:value`)}
              size="small"
              value={row.value}
              aria-label={t("rest.valueColumn")}
              onChange={(e) => update(row.id, { value: e.target.value })}
            />
          ) : (
            <div className={styles.file}>
              <Button size="small" onClick={() => void choose(row.id)}>
                {t("rest.chooseFile")}
              </Button>
              {row.file === "" ? (
                <span className={`${styles.path} muted`}>{t("rest.noFile")}</span>
              ) : (
                <span className={styles.path} title={row.file}>
                  {fileName(row.file)}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            className={styles.remove}
            aria-label={t("rest.removeRow")}
            title={t("rest.removeRow")}
            onClick={() => onChange(rows.filter((kept) => kept.id !== row.id))}
          >
            <CloseIcon size="0.9em" />
          </button>
        </div>
      ))}
      <div className={`${styles.row} ${styles.draft}`}>
        <span />
        <Input
          size="small"
          value=""
          placeholder={t("rest.addRow")}
          aria-label={t("rest.addRow")}
          onChange={(e) => append("key", e.target.value)}
        />
        <span />
        <Input
          size="small"
          value=""
          aria-label={t("rest.valueColumn")}
          onChange={(e) => append("value", e.target.value)}
        />
        <span />
      </div>
    </div>
  );
}

export default MultipartTable;

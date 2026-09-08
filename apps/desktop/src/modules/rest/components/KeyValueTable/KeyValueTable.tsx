import Input from "../../../../components/Input";
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { useDraftFocus } from "../../draftFocus";
import type { KeyValue } from "../../types";
import styles from "./KeyValueTable.module.css";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * The Params and Headers tables, and from Phase 3 the form-body one too.
 *
 * There is always one empty row at the foot, and it is not in the data: typing into it is what
 * adds a row. That is what makes a table with no Add button, and it is why an empty table is
 * still something you can type into.
 *
 * The tick is how a row is parked. An unticked row is left out of the request and kept in the
 * table, which is the only way to try without a header and get it back.
 */
function KeyValueTable({ rows, onChange, keyPlaceholder, valuePlaceholder }: Props) {
  const { t } = useTranslation();

  const { bind, owe } = useDraftFocus();

  function update(id: string, patch: Partial<KeyValue>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function append(column: "key" | "value", text: string) {
    const id = crypto.randomUUID();
    owe(`${id}:${column}`);
    onChange([...rows, { id, enabled: true, key: "", value: "", [column]: text }]);
  }

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span />
        <span>{t("rest.keyColumn")}</span>
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
            placeholder={keyPlaceholder}
            aria-label={t("rest.keyColumn")}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <Input
            ref={bind(`${row.id}:value`)}
            size="small"
            value={row.value}
            placeholder={valuePlaceholder}
            aria-label={t("rest.valueColumn")}
            onChange={(e) => update(row.id, { value: e.target.value })}
          />
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
          placeholder={keyPlaceholder ?? t("rest.addRow")}
          aria-label={t("rest.addRow")}
          onChange={(e) => append("key", e.target.value)}
        />
        <Input
          size="small"
          value=""
          placeholder={valuePlaceholder}
          aria-label={t("rest.valueColumn")}
          onChange={(e) => append("value", e.target.value)}
        />
        <span />
      </div>
    </div>
  );
}

export default KeyValueTable;

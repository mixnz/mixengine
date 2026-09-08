import { useState } from "react";
import CollationSelect from "../CollationSelect";
import NameDialog, { fieldClassName } from "../../../../components/NameDialog";
import { useTranslation } from "../../../../i18n";
import type { SqlCollation } from "../../types";
import { useSqlDialect } from "../../sql/context";

/** The engines "create table" offers on ClickHouse, in the order they are shown.
 *
 *  Four, not the whole MergeTree family: `CollapsingMergeTree` and `VersionedCollapsingMergeTree`
 *  each require a parameter naming a column that does not exist yet when the table is created, and
 *  the server refuses them (`Code: 42 ... requires 1 parameter`). This repeats `ENGINES` in
 *  `clickhouse_ddl.rs` — that side is what refuses, this side is what offers. */
export const CLICKHOUSE_ENGINES = [
  "MergeTree",
  "ReplacingMergeTree",
  "SummingMergeTree",
  "AggregatingMergeTree",
] as const;

interface Props {
  /** The database the table is to be created in — named in the title, since the sidebar's own
   *  picker is behind the dialog. */
  database: string;
  /** What this server supports, for the collation picker. Empty leaves it a text box. */
  collations: SqlCollation[];
  onCancel: () => void;
  /** Rejects with the reason the CREATE failed, which the dialog then shows. */
  onSubmit: (name: string, collation: string | null, engine: string | null) => Promise<void>;
}

/**
 * The form behind the sidebar's "new table": a name and — on MySQL — a collation, which are the
 * two things a table is hard to change afterwards. The columns are not asked for here: the table
 * is created with an `id` primary key and grows the rest of its columns in the Structure tab.
 *
 * PostgreSQL is asked only for the name, since a table there carries no collation of its own — only
 * its individual text columns do. The name may carry a schema (`sales.orders`), exactly as the
 * sidebar writes one, and that is how a table is created outside `public`.
 */
function TableDialog({ database, collations, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const { kind, editing: offers } = useSqlDialect();
  const [collation, setCollation] = useState("");
  const [engine, setEngine] = useState<string>(CLICKHOUSE_ENGINES[0]);

  return (
    <NameDialog
      title={t("tableDialog.title", { database })}
      ariaLabel={database}
      label={t("tableDialog.name")}
      emptyError={t("tableDialog.errorName")}
      submitLabel={t("tableDialog.submit")}
      savingLabel={t("tableDialog.saving")}
      hint={t(
        kind === "clickhouse"
          ? "tableDialog.columnHintClickhouse"
          : kind === "postgres"
            ? "tableDialog.columnHintPostgres"
            : "tableDialog.columnHint",
      )}
      extraFields={
        /* Gated on `kind` rather than on a flag of its own: only one dialect has this field, unlike
           collation, which MySQL reaches through `tableCollation`. */
        kind === "clickhouse"
          ? (saving) => (
              <label className={fieldClassName}>
                {t("tableDialog.engine")}
                <select
                  value={engine}
                  disabled={saving}
                  aria-label={t("tableDialog.engine")}
                  onChange={(e) => setEngine(e.target.value)}
                >
                  {CLICKHOUSE_ENGINES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <span className="muted">{t("tableDialog.engineHint")}</span>
              </label>
            )
          : offers.tableCollation
            ? (saving) => (
                <label className={fieldClassName}>
                  {t("tableDialog.collation")}
                  <CollationSelect
                    value={collation}
                    collations={collations}
                    placeholder={t("tableDialog.collationPlaceholder")}
                    ariaLabel={t("tableDialog.collation")}
                    disabled={saving}
                    onChange={setCollation}
                  />
                </label>
              )
            : undefined
      }
      onCancel={onCancel}
      onSubmit={(name) =>
        onSubmit(
          name,
          collation.trim() === "" ? null : collation.trim(),
          kind === "clickhouse" ? engine : null,
        )
      }
    />
  );
}

export default TableDialog;

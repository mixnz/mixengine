import { useState } from "react";
import CollationSelect from "../CollationSelect";
import NameDialog, { fieldClassName } from "../../../../components/NameDialog";
import { useTranslation } from "../../../../i18n";
import type { SqlCollation } from "../../types";
import { useSqlDialect } from "../../sql/context";

interface Props {
  /** What this server supports, for the collation picker. Empty leaves it a text box. */
  collations: SqlCollation[];
  onCancel: () => void;
  /** Rejects with the reason the CREATE failed, which the dialog then shows. */
  onSubmit: (name: string, collation: string | null) => Promise<void>;
}

/**
 * The form behind the database picker's "new database": a name, and — where the engine has one —
 * the collation every table created in it will inherit unless it says otherwise.
 *
 * PostgreSQL is asked only for the name. A database's collation there is a locale of the host
 * operating system rather than a name from the server's own list, and setting one demands a
 * template database and an encoding to go with it — more than a two-field dialog can honestly ask.
 */
function DatabaseDialog({ collations, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const { editing: offers } = useSqlDialect();
  const [collation, setCollation] = useState("");

  return (
    <NameDialog
      title={t("databaseDialog.title")}
      ariaLabel={t("databaseDialog.title")}
      label={t("databaseDialog.name")}
      emptyError={t("databaseDialog.errorName")}
      submitLabel={t("databaseDialog.submit")}
      savingLabel={t("databaseDialog.saving")}
      extraFields={
        offers.databaseCollation
          ? (saving) => (
              <label className={fieldClassName}>
                {t("databaseDialog.collation")}
                <CollationSelect
                  value={collation}
                  collations={collations}
                  placeholder={t("databaseDialog.collationPlaceholder")}
                  ariaLabel={t("databaseDialog.collation")}
                  disabled={saving}
                  onChange={setCollation}
                />
              </label>
            )
          : undefined
      }
      onCancel={onCancel}
      onSubmit={(name) => onSubmit(name, collation.trim() === "" ? null : collation.trim())}
    />
  );
}

export default DatabaseDialog;

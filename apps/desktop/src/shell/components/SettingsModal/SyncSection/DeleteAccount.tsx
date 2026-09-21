import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import NoticeBanner from "../../../../components/NoticeBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { syncDeleteAccount } from "../../../sync/api";
import settings from "../SettingsModal.module.css";
import Field from "./Field";
import styles from "./SyncSection.module.css";

interface Props {
  server: string;
  onDeleted: () => void;
  onCancel: () => void;
}

/**
 * Deleting the account (D4b): everything it holds on the server, and every machine signed out.
 * **Asks for the password**, because the session alone is what a borrowed machine already has, and
 * says what goes before it goes.
 */
function DeleteAccount({ server, onDeleted, onCancel }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      await syncDeleteAccount(password);
      onDeleted();
    } catch (error) {
      setProblem(errorMessage(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={settings.section}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className={settings.sectionLabel}>{t("sync.deleteAccount")}</span>
      <NoticeBanner message={t("sync.deleteAccountWarning", { server })} />
      <Field label={t("common.password")}>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.row}>
        <Button size="small" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          variant="danger"
          type="submit"
          disabled={password === ""}
          busy={busy ? t("sync.deleting") : undefined}
        >
          {t("sync.deleteAccountAction")}
        </Button>
      </div>
    </form>
  );
}

export default DeleteAccount;

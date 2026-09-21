import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { syncChangePassword } from "../../../sync/api";
import settings from "../SettingsModal.module.css";
import Field from "./Field";
import PasswordPair from "./PasswordPair";
import styles from "./SyncSection.module.css";

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

/** D6 case 1: the current password, then the new one twice. Every other machine is signed out. */
function ChangePassword({ onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    if (next !== again) {
      setProblem(t("sync.passwordsDiffer"));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await syncChangePassword(current, next);
      onDone();
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
      <span className={settings.sectionLabel}>{t("sync.changePassword")}</span>
      <Field label={t("sync.currentPassword")}>
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>
      <PasswordPair
        label={t("sync.newPassword")}
        hint={t("sync.changePasswordHint")}
        password={next}
        again={again}
        onPassword={setNext}
        onAgain={setAgain}
      />
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
          variant="primary"
          type="submit"
          disabled={current === "" || next === "" || again === ""}
          busy={busy ? t("sync.saving") : undefined}
        >
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export default ChangePassword;

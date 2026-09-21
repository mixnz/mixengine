import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { syncVerify, type SyncStatus } from "../../../sync/api";
import settings from "../SettingsModal.module.css";
import Field from "./Field";
import styles from "./SyncSection.module.css";

interface Props {
  email: string;
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
  /** Reached without the key on screen — the dialog was closed and opened again — so it is gone. */
  lostKey: boolean;
  onVerified: (status: SyncStatus) => void;
  onStartOver: () => void;
}

/** The code from the letter, which confirms the address and signs this machine in as the first. */
function VerifyCode({ email, deviceName, onDeviceNameChange, lostKey, onVerified, onStartOver }: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      onVerified(await syncVerify(code.trim(), deviceName.trim()));
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
      <span className={settings.sectionLabel}>{t("sync.codeTitle")}</span>
      <p className={settings.hint}>{t("sync.codeHint", { email })}</p>
      {lostKey && <p className={settings.hint}>{t("sync.recoveryLost")}</p>}
      <Field label={t("sync.code")}>
        <Input mono value={code} placeholder="XXXX-XXXX" onChange={(event) => setCode(event.target.value)} />
      </Field>
      <Field label={t("sync.deviceName")}>
        <Input value={deviceName} onChange={(event) => onDeviceNameChange(event.target.value)} />
      </Field>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.row}>
        <Button size="small" variant="ghost" onClick={onStartOver}>
          {t("sync.startOver")}
        </Button>
        <Button
          size="small"
          variant="primary"
          type="submit"
          disabled={code.trim() === "" || deviceName.trim() === ""}
          busy={busy ? t("sync.confirming") : undefined}
        >
          {t("common.confirm")}
        </Button>
      </div>
    </form>
  );
}

export default VerifyCode;

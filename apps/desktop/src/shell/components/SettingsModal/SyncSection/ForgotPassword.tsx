import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import NoticeBanner from "../../../../components/NoticeBanner";
import SegmentedControl from "../../../../components/SegmentedControl";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import {
  syncResetAsk,
  syncResetKeep,
  syncResetOpen,
  syncResetPrepare,
  syncResetStartOver,
  type SyncStatus,
} from "../../../sync/api";
import settings from "../SettingsModal.module.css";
import Field from "./Field";
import PasswordPair from "./PasswordPair";
import RecoveryKey from "./RecoveryKey";
import styles from "./SyncSection.module.css";

type Have = "key" | "none";

/**
 * How far a reset has got. `email` asks for the letter; `code` takes it and the choice between
 * cases 2 and 3; `ceremony` shows case 3's new key; `finish` spends the code, which deletes.
 */
type Phase = { kind: "email" } | { kind: "code" } | { kind: "ceremony"; key: string } | { kind: "finish" };

interface Props {
  server: string;
  access: string | null;
  initialEmail: string;
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
  onSignedIn: (status: SyncStatus) => void;
  onCancel: () => void;
}

/**
 * A forgotten password (D6). **The letter decides who you are; the recovery key decides what
 * survives**: with it the records stay (case 2), without it everything on the server is deleted
 * and this machine starts over under a new key (case 3) — said before it happens, and done only
 * after the new recovery key has been typed back.
 */
function ForgotPassword({ server, access, initialEmail, deviceName, onDeviceNameChange, onSignedIn, onCancel }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "email" });
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [have, setHave] = useState<Have>("key");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  /** Case 2's code is spent once; after that Rust holds the ticket and a retry skips it. */
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(errorMessage(t, error));
    } finally {
      setBusy(false);
    }
  }

  const askCode = () =>
    run(async () => {
      await syncResetAsk(server, access, email.trim());
      setPhase({ kind: "code" });
    });

  const reset = () =>
    run(async () => {
      if (password !== again) {
        setProblem(t("sync.passwordsDiffer"));
        return;
      }
      if (have === "key") {
        if (!opened) {
          await syncResetOpen(server, access, email.trim(), code.trim());
          setOpened(true);
        }
        onSignedIn(await syncResetKeep(recoveryKey, password, deviceName.trim()));
      } else {
        setPhase({ kind: "ceremony", key: await syncResetPrepare(server, access, email.trim(), password) });
      }
    });

  const startOver = () =>
    run(async () => {
      onSignedIn(await syncResetStartOver(code.trim(), deviceName.trim()));
    });

  const problemLine = problem && (
    <p className={styles.problem} role="alert">
      {problem}
    </p>
  );

  if (phase.kind === "ceremony") {
    return <RecoveryKey recoveryKey={phase.key} onDone={() => setPhase({ kind: "finish" })} />;
  }

  if (phase.kind === "finish") {
    return (
      <form
        className={settings.section}
        onSubmit={(event) => {
          event.preventDefault();
          void startOver();
        }}
      >
        <span className={settings.sectionLabel}>{t("sync.finishTitle")}</span>
        <NoticeBanner message={t("sync.resetDeletesEverything")} />
        <Field label={t("sync.code")}>
          <Input mono value={code} onChange={(event) => setCode(event.target.value)} />
        </Field>
        {problemLine}
        <div className={styles.row}>
          <Button size="small" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="small" variant="danger" type="submit" busy={busy ? t("sync.resetting") : undefined}>
            {t("sync.resetStartOver")}
          </Button>
        </div>
      </form>
    );
  }

  if (phase.kind === "email") {
    return (
      <form
        className={settings.section}
        onSubmit={(event) => {
          event.preventDefault();
          void askCode();
        }}
      >
        <span className={settings.sectionLabel}>{t("sync.forgotTitle")}</span>
        <p className={settings.hint}>{t("sync.forgotHint", { server })}</p>
        <Field label={t("sync.email")}>
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {problemLine}
        <div className={styles.row}>
          <Button size="small" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            size="small"
            variant="primary"
            type="submit"
            disabled={email.trim() === ""}
            busy={busy ? t("sync.sendingCode") : undefined}
          >
            {t("sync.sendCode")}
          </Button>
        </div>
      </form>
    );
  }

  const ready =
    code.trim() !== "" &&
    password !== "" &&
    again !== "" &&
    deviceName.trim() !== "" &&
    (have === "none" || recoveryKey.trim() !== "");

  return (
    <form
      className={settings.section}
      onSubmit={(event) => {
        event.preventDefault();
        void reset();
      }}
    >
      <span className={settings.sectionLabel}>{t("sync.forgotTitle")}</span>
      <p className={settings.hint}>{t("sync.codeHint", { email: email.trim() })}</p>
      <Field label={t("sync.code")}>
        <Input mono value={code} disabled={opened} onChange={(event) => setCode(event.target.value)} />
      </Field>
      <SegmentedControl<Have>
        aria-label={t("sync.recoveryTitle")}
        block
        value={have}
        onChange={setHave}
        segments={[
          { value: "key", label: t("sync.haveKey") },
          // A code case 2 has spent cannot delete anything, so case 3 is no longer on offer.
          { value: "none", label: t("sync.noKey"), disabled: opened },
        ]}
      />
      {have === "key" ? (
        <Field label={t("sync.recoveryKey")}>
          <Input mono value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} />
        </Field>
      ) : (
        <NoticeBanner message={t("sync.resetDeletesEverything")} />
      )}
      <PasswordPair
        label={t("sync.newPassword")}
        hint={t("sync.passwordHint")}
        password={password}
        again={again}
        onPassword={setPassword}
        onAgain={setAgain}
      />
      <Field label={t("sync.deviceName")}>
        <Input value={deviceName} onChange={(event) => onDeviceNameChange(event.target.value)} />
      </Field>
      {problemLine}
      <div className={styles.row}>
        <Button size="small" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          variant={have === "key" ? "primary" : "danger"}
          type="submit"
          disabled={!ready}
          busy={busy ? t("sync.resetting") : undefined}
        >
          {t(have === "key" ? "sync.resetKeep" : "sync.continue")}
        </Button>
      </div>
    </form>
  );
}

export default ForgotPassword;

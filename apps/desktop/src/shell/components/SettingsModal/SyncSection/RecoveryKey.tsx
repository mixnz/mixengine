import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { copyText } from "../../../../core/clipboard";
import { useTranslation } from "../../../../i18n";
import { groupsOf, pickTwo, typedBack } from "../../../sync/ceremony";
import settings from "../SettingsModal.module.css";
import styles from "./SyncSection.module.css";

interface Props {
  recoveryKey: string;
  /** Two groups typed back correctly: on to the letter's code. */
  onDone: () => void;
}

/**
 * The recovery key, shown once, and the two groups that have to be typed back before registration
 * goes on (D2). Held in this component's props and nowhere else: when it unmounts, the key is gone.
 */
function RecoveryKey({ recoveryKey, onDone }: Props) {
  const { t } = useTranslation();
  const groups = groupsOf(recoveryKey);
  const [checking, setChecking] = useState(false);
  const [picked] = useState(() => pickTwo(groups.length));
  const [typed, setTyped] = useState(["", ""]);
  const [mismatch, setMismatch] = useState(false);

  if (!checking) {
    return (
      <div className={settings.section}>
        <span className={settings.sectionLabel}>{t("sync.recoveryTitle")}</span>
        <p className={settings.hint}>{t("sync.recoveryHint")}</p>
        <ol className={styles.groups}>
          {groups.map((group, index) => (
            <li key={index} className={styles.group}>
              <span className={styles.groupIndex}>{index + 1}</span>
              {group}
            </li>
          ))}
        </ol>
        <div className={styles.row}>
          <Button size="small" onClick={() => void copyText(recoveryKey).catch(() => {})}>
            {t("sync.recoveryCopy")}
          </Button>
          <Button size="small" variant="primary" onClick={() => setChecking(true)}>
            {t("sync.recoveryWritten")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={settings.section}
      onSubmit={(event) => {
        event.preventDefault();
        if (typedBack(recoveryKey, picked, typed)) onDone();
        else setMismatch(true);
      }}
    >
      <span className={settings.sectionLabel}>
        {t("sync.recoveryCheck", { first: picked[0] + 1, second: picked[1] + 1 })}
      </span>
      <div className={styles.row}>
        {picked.map((index, n) => (
          <Input
            key={index}
            mono
            aria-label={t("sync.recoveryGroup", { n: index + 1 })}
            placeholder={t("sync.recoveryGroup", { n: index + 1 })}
            value={typed[n]}
            onChange={(event) => {
              const next = [...typed];
              next[n] = event.target.value;
              setTyped(next);
              setMismatch(false);
            }}
          />
        ))}
      </div>
      {mismatch && (
        <p className={styles.problem} role="alert">
          {t("sync.recoveryMismatch")}
        </p>
      )}
      <div className={styles.row}>
        <Button size="small" variant="ghost" onClick={() => setChecking(false)}>
          {t("sync.recoveryShowAgain")}
        </Button>
        <Button size="small" variant="primary" type="submit">
          {t("sync.continue")}
        </Button>
      </div>
    </form>
  );
}

export default RecoveryKey;

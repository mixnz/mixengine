import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { formatBytes } from "../../format";
import { BODY_MAX_BYTES, MAX_ENTRIES } from "../../history";
import { clearHistory, dropHistoryBodies, useHistory } from "../../historyStore";
import {
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  clampTimeoutSeconds,
  updateWorkspace,
  useWorkspace,
} from "../../workspace";
import styles from "./RestSettings.module.css";

/**
 * The REST module's pane in the app's Settings dialog.
 *
 * Every control writes through to `rest-workspace.json` as it is changed, so there is no Save
 * button here either. One of them is destructive on purpose: turning *Keep response bodies* off
 * forgets the bodies already kept, because a switch about privacy that leaves what it wrote sitting
 * on disk is a lie. The line under it says so before it is pressed.
 */
function RestSettings() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const history = useHistory();
  const [confirmClear, setConfirmClear] = useState(false);
  /** The box while it is being typed in, so a half-typed number is not clamped mid-keystroke. */
  const [seconds, setSeconds] = useState<string | null>(null);

  function commitTimeout(text: string) {
    updateWorkspace({ timeoutMs: clampTimeoutSeconds(Number(text)) * 1000 });
    setSeconds(null);
  }

  return (
    <>
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t("rest.settingsHistoryGroup")}</span>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={workspace.keepResponseBodies}
            onChange={(e) => {
              updateWorkspace({ keepResponseBodies: e.target.checked });
              // Not merely "stop recording them" — see the note on the component.
              if (!e.target.checked) dropHistoryBodies();
            }}
          />
          <span>{t("rest.settingsKeepBodies")}</span>
        </label>
        <p className={styles.hint}>
          {t("rest.settingsKeepBodiesHint", { limit: formatBytes(BODY_MAX_BYTES) })}
        </p>

        <div className={styles.row}>
          <Button
            size="small"
            disabled={history.length === 0}
            onClick={() => {
              if (confirmClear) {
                clearHistory();
                setConfirmClear(false);
                return;
              }
              setConfirmClear(true);
            }}
            onBlur={() => setConfirmClear(false)}
          >
            <TrashIcon size="0.9em" />
            {confirmClear ? t("rest.settingsClearHistoryConfirm") : t("rest.settingsClearHistory")}
          </Button>
          <span className={styles.count}>
            {t("rest.settingsHistoryCount", { n: history.length, max: MAX_ENTRIES })}
          </span>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>{t("rest.settingsSendGroup")}</span>

        <div className={styles.row}>
          <span className={styles.label}>{t("rest.settingsTimeout")}</span>
          <Input
            size="small"
            type="number"
            className={styles.number}
            min={MIN_TIMEOUT_SECONDS}
            max={MAX_TIMEOUT_SECONDS}
            value={seconds ?? String(workspace.timeoutMs / 1000)}
            aria-label={t("rest.settingsTimeout")}
            onChange={(e) => setSeconds(e.target.value)}
            onBlur={(e) => commitTimeout(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTimeout(e.currentTarget.value);
            }}
          />
          <span className={styles.unit}>{t("rest.settingsTimeoutUnit")}</span>
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={workspace.followRedirects}
            onChange={(e) => updateWorkspace({ followRedirects: e.target.checked })}
          />
          <span>{t("rest.settingsFollowRedirects")}</span>
        </label>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={workspace.acceptInvalidCerts}
            onChange={(e) => updateWorkspace({ acceptInvalidCerts: e.target.checked })}
          />
          <span>{t("rest.settingsInvalidCerts")}</span>
        </label>
        <p className={styles.hint}>{t("rest.settingsInvalidCertsHint")}</p>
        <p className={styles.hint}>{t("rest.settingsGlobalHint")}</p>
      </div>
    </>
  );
}

export default RestSettings;

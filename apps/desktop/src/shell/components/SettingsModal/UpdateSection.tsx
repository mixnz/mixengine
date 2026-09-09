import { appLogDir } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "../../../i18n";
import { PRIVACY_POLICY_URL } from "../../links";
import { openReleasesPage, useAppVersion } from "../../version";
import styles from "./SettingsModal.module.css";

/**
 * What version is running, and where a newer one comes from.
 *
 * **A signpost since T106**, not an updater. MixEngine's updater is the only one: the MixEngine tab's
 * own Settings has the check, the offer and the Install button, and this window is replaced by the
 * same swap that replaces the daemon. What is left here is the running version, the sentence that
 * says where updating happens, and the release page for a copy something else installed.
 */
function UpdateSection() {
  const { t } = useTranslation();
  const version = useAppVersion();

  return (
    /* No heading of its own: the pane is reached by a list that already names it. */
    <div className={styles.section}>
      <div className={styles.updateRow}>
        <div className={styles.updateText}>
          <span className={styles.updateVersion}>
            {version === "" ? t("update.notCheckedYet") : t("update.runningNow", { version })}
          </span>
          <span className={styles.updateStatus}>{t("update.unavailable")}</span>
        </div>
        <div className={styles.toolSuiteActions}>
          <button type="button" className={styles.toolButton} onClick={() => void openReleasesPage()}>
            {t("update.openPage")}
          </button>
        </div>
      </div>

      <p className={styles.hint}>{t("update.autoHint")}</p>

      {/* The privacy policy sits in this pane rather than one of its own. It is the only pane about
          the app itself rather than about what you do with it — it is where the running version is
          named — and a sixth entry in the column for a single outbound link would cost the reader
          more than it gives them. Most people arrive at the policy from the store listing anyway;
          this is the copy that is here when they look for it inside the app. */}
      <div className={styles.updateRow}>
        <span className={styles.hint}>{t("settings.privacyHint")}</span>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void openUrl(PRIVACY_POLICY_URL)}
        >
          {t("settings.privacyPolicy")}
        </button>
      </div>

      <div className={styles.updateRow}>
        <span className={styles.hint}>{t("settings.logHint")}</span>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void appLogDir().then(revealItemInDir)}
        >
          {t("settings.openLogFolder")}
        </button>
      </div>
    </div>
  );
}

export default UpdateSection;

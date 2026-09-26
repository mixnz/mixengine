import { appLogDir } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import Button from "../../../components/Button";
import ErrorBanner from "../../../components/ErrorBanner";
import Switch from "../../../components/Switch";
import { errorMessage } from "../../../core/errors";
import { useTranslation } from "../../../i18n";
import { privacyPolicyUrl } from "../../links";
import type { Updates } from "../../update";
import { openReleasesPage } from "../../version";
import styles from "./SettingsModal.module.css";

/**
 * MixLab's updater — T187, `docs/specs/2026-09-26-t187-mixlab-updates-itself-design.md`, D9.
 *
 * Since ADR 0056 this is where MixLab is updated, with or without MixEngine: the running version,
 * the check, the offer and the install. What it draws is `updates.view`, decided in
 * `shell/update/view.ts` from values alone; this file only lays it out.
 */
function UpdateSection({ updates }: { updates: Updates }) {
  const { t, lang } = useTranslation();
  const { status, view, progress, handedOver } = updates;
  const feed = status?.feed ?? null;
  const onInstaller = status?.placement.kind === "installer";

  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.floor((progress.received / progress.total) * 100)) : 0;

  return (
    /* No heading of its own: the pane is reached by a list that already names it. */
    <div className={styles.section}>
      <div className={styles.updateRow}>
        <div className={styles.updateText}>
          <span className={styles.updateVersion}>
            {status ? t("update.runningNow", { version: status.current }) : t("update.neverChecked")}
          </span>
          <span className={styles.updateStatus}>
            {status?.checkedAt
              ? t("update.checkedAt", { time: new Date(status.checkedAt).toLocaleTimeString() })
              : t("update.neverChecked")}
          </span>
        </div>
        {view !== "development" && view !== "elsewhere" && (
          <Button
            size="small"
            onClick={() => void updates.checkNow()}
            busy={updates.checking ? t("update.checking") : undefined}
          >
            {t("update.checkNow")}
          </Button>
        )}
      </div>

      {updates.checkFailure && <p className={styles.hint}>{t("update.checkFailed", { message: updates.checkFailure })}</p>}

      {status && view !== "development" && view !== "elsewhere" && (
        <div className={styles.updateRow}>
          <div className={styles.updateText}>
            <span id="update-automatic-label">{t("update.automatic")}</span>
            <span className={styles.updateStatus}>{t("update.automaticHint")}</span>
          </div>
          <Switch
            checked={status.automatic}
            onChange={(on) => void updates.setAutomatic(on)}
            aria-labelledby="update-automatic-label"
          />
        </div>
      )}

      {view === "offer" && feed && (
        <div className={styles.updateOffer}>
          <span className={styles.updateVersion}>{t("update.offered", { version: feed.version })}</span>
          {feed.size !== null && (
            <span className={styles.updateStatus}>
              {t("update.size", { size: Math.max(1, Math.round(feed.size / 1_000_000)) })}
            </span>
          )}
          {feed.notes && <pre className={styles.updateNotes}>{feed.notes}</pre>}
          {feed.notesUrl && (
            <Button variant="link" size="small" onClick={() => void openUrl(feed.notesUrl ?? "")}>
              {t("update.notesLink")}
            </Button>
          )}
          {!onInstaller && <p className={styles.hint}>{t("update.daemonRestarts")}</p>}
          <div className={styles.updateActions}>
            <Button variant="primary" size="small" onClick={() => void updates.install()}>
              {onInstaller ? t("update.openInstaller") : t("update.install")}
            </Button>
            <Button size="small" onClick={updates.remindLater}>
              {t("update.later")}
            </Button>
            <Button variant="ghost" size="small" onClick={() => void updates.skip()}>
              {t("update.skip")}
            </Button>
          </div>
        </div>
      )}

      {view === "installing" && (
        <p className={styles.hint}>
          {progress && progress.received < progress.total
            ? t("update.downloading", { percent })
            : t("update.installing")}
        </p>
      )}

      {/* The installer's download has its own progress, before `handedOver` is set. */}
      {onInstaller && progress && view === "offer" && (
        <p className={styles.hint}>{t("update.downloading", { percent })}</p>
      )}

      {(view === "handedOver" || view === "finish") && handedOver && (
        <div className={styles.updateOffer}>
          {view === "finish" && feed ? (
            <p className={styles.hint}>{t("update.installerReady", { version: feed.version })}</p>
          ) : (
            <>
              <p className={styles.hint}>
                {handedOver.opened ? t("update.installerOpen") : t("update.installerNotOpened")}
              </p>
              {handedOver.opened && <p className={styles.hint}>{t("update.installerCommand")}</p>}
              <code className={styles.updateCommand}>{handedOver.command}</code>
            </>
          )}
          <div className={styles.updateActions}>
            {view === "finish" ? (
              <Button variant="primary" size="small" onClick={() => void updates.finish()}>
                {t("update.installerFinish")}
              </Button>
            ) : (
              <Button size="small" onClick={() => void updates.install()}>
                {t("update.installerReopen")}
              </Button>
            )}
            <Button variant="ghost" size="small" onClick={updates.backFromHandover}>
              {t("update.installerBack")}
            </Button>
          </div>
        </div>
      )}

      {view === "upToDate" && status?.feed && <p className={styles.hint}>{t("update.upToDate")}</p>}
      {view === "noBuild" && feed && <p className={styles.hint}>{t("update.noBuild", { version: feed.version })}</p>}
      {view === "skipped" && feed && <p className={styles.hint}>{t("update.skipped", { version: feed.version })}</p>}

      {(view === "development" || view === "elsewhere") && (
        <div className={styles.updateRow}>
          <span className={styles.hint}>{t(view === "development" ? "update.development" : "update.elsewhere")}</span>
          <Button size="small" onClick={() => void openReleasesPage()}>
            {t("update.openPage")}
          </Button>
        </div>
      )}

      {updates.error !== null && (
        <ErrorBanner message={errorMessage(t, updates.error)} onDismiss={updates.dismissError} />
      )}

      {/* The privacy policy sits in this pane rather than one of its own. It is the only pane about
          the app itself rather than about what you do with it — it is where the running version is
          named — and a sixth entry in the column for a single outbound link would cost the reader
          more than it gives them. */}
      <div className={styles.updateRow}>
        <span className={styles.hint}>{t("settings.privacyHint")}</span>
        <Button size="small" onClick={() => void openUrl(privacyPolicyUrl(lang))}>
          {t("settings.privacyPolicy")}
        </Button>
      </div>

      <div className={styles.updateRow}>
        <span className={styles.hint}>{t("settings.logHint")}</span>
        <Button size="small" onClick={() => void appLogDir().then(revealItemInDir)}>
          {t("settings.openLogFolder")}
        </Button>
      </div>
    </div>
  );
}

export default UpdateSection;

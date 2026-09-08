import { CloseIcon, DownloadIcon, ReloadIcon } from "../../../icons";
import { useTranslation } from "../../../i18n";
import type { UpdateCheck } from "../../update";
import styles from "./UpdateToast.module.css";

interface Props {
  update: UpdateCheck;
}

/** How many of the release's entries the panel shows before it starts counting the rest. Three is
 *  what fits in a corner without the panel becoming something to be read rather than glanced at. */
const MAX_HIGHLIGHTS = 3;

/** How long one entry may run before it is cut. Changelog lines are one short sentence, so this
 *  only catches the occasional long one. */
const MAX_HIGHLIGHT_LENGTH = 120;

/** Markdown as plain text: the panel is not a renderer, and raw `code`, **bold** and link syntax
 *  read worse than the words inside them. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the release actually changed, one entry per line.
 *
 * The notes are the changelog section for the version, so they open with `### Added` or
 * `### Changed` and the substance is in the list under it — headings are skipped for that reason,
 * and taking the first non-empty line instead would announce every release as "Added".
 *
 * Entries wrap across lines in the changelog, so a line that is not itself a bullet continues the
 * one above it. Notes written as prose rather than as a list still get their first paragraph.
 */
function highlights(notes: string): string[] {
  const lines = notes.replace(/\r\n/g, "\n").split("\n");
  const bullets: string[] = [];
  const prose: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || /^#{1,6}\s/.test(trimmed)) continue;

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      bullets.push(bullet[1]);
    } else if (bullets.length > 0) {
      bullets[bullets.length - 1] += ` ${trimmed}`;
    } else {
      prose.push(trimmed);
    }
  }

  const source = bullets.length > 0 ? bullets : prose.length > 0 ? [prose.join(" ")] : [];

  return source
    .map(stripMarkdown)
    .filter((entry) => entry !== "")
    .map((entry) =>
      entry.length > MAX_HIGHLIGHT_LENGTH ? `${entry.slice(0, MAX_HIGHLIGHT_LENGTH - 1)}…` : entry,
    );
}

/**
 * The update, in the corner of the window: what is out, how far it has downloaded, and the button
 * that puts it in place.
 *
 * A corner rather than a bar across the top: this arrives while the user is in the middle of
 * something, and nothing here is urgent enough to move the thing they are looking at. Closing it
 * does not stop a download — it only hides the panel, and the MixDB button stays lit.
 */
function UpdateToast({ update }: Props) {
  const { t } = useTranslation();
  const { release, current, status, progress, error } = update;
  if (release === null) return null;

  const changes = highlights(release.notes);
  const shown = changes.slice(0, MAX_HIGHLIGHTS);
  const more = changes.length - shown.length;
  const downloading = status === "downloading";
  const installing = status === "installing";

  return (
    <div className={`${styles.toast} glass`} role="status" aria-live="polite">
      <div className={styles.header}>
        <span className={styles.title}>
          {status === "downloaded"
            ? t("update.downloaded", { version: release.version })
            : t("update.available", { version: release.version })}
        </span>
        <button type="button" className={styles.close} onClick={update.dismiss} title={t("update.later")}>
          <CloseIcon />
        </button>
      </div>

      {status === "available" && (
        <>
          <p className={styles.current}>{t("update.runningNow", { version: current })}</p>
          {shown.length > 0 && (
            <ul className={styles.changes}>
              {shown.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
              {more > 0 && <li className={styles.more}>{t("update.moreChanges", { count: more })}</li>}
            </ul>
          )}
          <p className={styles.hint}>{t("update.autoHint")}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.download} onClick={update.download}>
              <DownloadIcon />
              {t("update.updateNow")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.dismiss}>
              {t("update.later")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.skip}>
              {t("update.skip")}
            </button>
          </div>
        </>
      )}

      {(downloading || installing) && (
        <>
          <p className={styles.summary}>
            {installing
              ? t("update.installing")
              : progress < 0
                ? t("update.downloadingUnknown")
                : t("update.downloading", { percent: Math.round(progress * 100) })}
          </p>
          {/* Indeterminate whenever the server did not say how big the bundle is, which is what a
              negative progress means — a bar that sits at zero reads as a download that stalled. */}
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloading && progress >= 0 ? Math.round(progress * 100) : undefined}
          >
            <div
              className={downloading && progress >= 0 ? styles.bar : `${styles.bar} ${styles.barIndeterminate}`}
              style={downloading && progress >= 0 ? { width: `${progress * 100}%` } : undefined}
            />
          </div>
          {installing && <p className={styles.hint}>{t("update.restartHint")}</p>}
        </>
      )}

      {status === "downloaded" && (
        <>
          <p className={styles.hint}>{t("update.restartHint")}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.download} onClick={update.install}>
              <ReloadIcon />
              {t("update.restartNow")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.dismiss}>
              {t("update.later")}
            </button>
          </div>
        </>
      )}

      {status === "error" && (
        <>
          <p className={styles.summary}>{t("update.failed", { message: error })}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.download} onClick={update.openPage}>
              <DownloadIcon />
              {t("update.openPage")}
            </button>
            <button type="button" className={styles.secondary} onClick={update.dismiss}>
              {t("update.later")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default UpdateToast;

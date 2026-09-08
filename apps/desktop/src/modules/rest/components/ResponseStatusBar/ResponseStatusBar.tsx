import { useTranslation } from "../../../../i18n";
import { formatBytes } from "../../format";
import type { SendState } from "../ResponsePane";
import styles from "./ResponseStatusBar.module.css";

interface Props {
  state: SendState;
}

/** The class of a status code, which is all its colour is about. */
function statusClass(status: number): string {
  if (status >= 500) return styles.s5xx;
  if (status >= 400) return styles.s4xx;
  if (status >= 300) return styles.s3xx;
  return styles.s2xx;
}

/**
 * What came back, in one line: the code, how long it took and how big it was.
 *
 * A cancelled send says so here rather than through a banner — nothing went wrong, someone
 * changed their mind. A send that failed leaves the previous response's line in place, because
 * the banner above is already saying what happened.
 */
function ResponseStatusBar({ state }: Props) {
  const { t } = useTranslation();
  const { response } = state;

  if (state.phase === "sending") return <div className={styles.bar}>{t("rest.sending")}</div>;
  if (state.phase === "cancelled" && response === null) {
    return <div className={`${styles.bar} muted`}>{t("rest.cancelled")}</div>;
  }
  if (response === null) return <div className={styles.bar} />;

  const redirected = response.final_url !== state.sentUrl;

  return (
    <div className={styles.bar}>
      <span className={`${styles.status} ${statusClass(response.status)}`}>
        {response.status} {response.status_text}
      </span>
      <span className={styles.figure} title={t("rest.totalTimeHint")}>
        {response.total_ms} ms
      </span>
      <span
        className={styles.figure}
        title={
          response.truncated
            ? t("rest.realSizeHint", { size: formatBytes(response.body_size) })
            : t("rest.sizeHint")
        }
      >
        {formatBytes(response.body_size)}
      </span>
      {redirected && (
        <span className={styles.redirect} title={t("rest.finalUrlHint", { url: response.final_url })}>
          {t("rest.redirected")}
        </span>
      )}
      {state.phase === "cancelled" && <span className="muted">{t("rest.cancelled")}</span>}
    </div>
  );
}

export default ResponseStatusBar;

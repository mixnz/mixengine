import { useMemo, useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { CloseIcon, TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { decodeBase64 } from "../../api";
import { detectBody } from "../../contentType";
import { formatBytes, prettyJson } from "../../format";
import { BODY_MAX_BYTES, type HistoryEntry } from "../../history";
import { clearHistory, forgetEntry, useHistory } from "../../historyStore";
import { findRequest } from "../../requests";
import { useRequestLists } from "../../requestsStore";
import styles from "./HistoryDialog.module.css";
import Modal from "../../../../components/Modal";

interface Props {
  /** Opens the request an entry was sent from. The dialog sees itself out on the way. */
  onOpenRequest: (id: string) => void;
  onClose: () => void;
}

/** The class of a status code, which is all its colour is about. */
function statusClass(status: number): string {
  if (status >= 500) return styles.s5xx;
  if (status >= 400) return styles.s4xx;
  if (status >= 300) return styles.s3xx;
  return styles.s2xx;
}

/**
 * Everything this app has sent, newest first.
 *
 * A list rather than a pane down the side: it is opened to find one send, and it closes as soon as
 * that send is found. One entry is open at a time — the body underneath it is the expensive part to
 * decode and the only part worth scrolling.
 *
 * The stored body is decoded and sniffed here rather than kept as text: the file holds base64
 * exactly as it came off the wire, and what it is — JSON, HTML, a PNG — is `detectBody`'s question,
 * asked from the bytes alone because the headers were never stored.
 */
function HistoryDialog({ onOpenRequest, onClose }: Props) {
  const { t, lang } = useTranslation();
  const history = useHistory();
  const lists = useRequestLists();
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** The entry whose delete button has been pressed once. Only ever one at a time, so the armed
   *  button is unmistakable. */
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return history;
    return history.filter(
      (entry) => entry.url.toLowerCase().includes(needle) || entry.method.toLowerCase() === needle,
    );
  }, [history, filter]);

  const when = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "medium" }),
    [lang],
  );

  /** The stored body as something to put on screen, or the reason there is nothing. */
  function body(entry: HistoryEntry) {
    if (entry.responseBody === null) {
      return (
        <p className={`${styles.note} muted`}>
          {entry.size > BODY_MAX_BYTES
            ? t("rest.historyBodyTooBig", { limit: formatBytes(BODY_MAX_BYTES) })
            : t("rest.historyNoBody")}
        </p>
      );
    }
    const bytes = decodeBase64(entry.responseBody);
    const detected = detectBody([], bytes);
    if (detected.text === null) {
      return (
        <p className={`${styles.note} muted`}>
          {t("rest.binaryBody", { mime: detected.mime, size: formatBytes(bytes.length) })}
        </p>
      );
    }
    return (
      <pre className={styles.body}>
        {detected.kind === "json" ? prettyJson(detected.text) : detected.text}
      </pre>
    );
  }

  return (
    <Modal
      label={t("rest.historyTitle")}
      onClose={onClose}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <div className={styles.header}>
            <h3 className={styles.title}>{t("rest.historyTitle")}</h3>
            <button
              type="button"
              className={styles.headerClose}
              onClick={() => close(onClose)}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <CloseIcon />
            </button>
          </div>

          <div className={styles.tools}>
            <Input
              size="small"
              value={filter}
              placeholder={t("rest.historyFilter")}
              aria-label={t("rest.historyFilter")}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            <Button
              size="small"
              disabled={history.length === 0}
              onClick={() => {
                setConfirmDrop(null);
                if (confirmClear) {
                  clearHistory();
                  setConfirmClear(false);
                  return;
                }
                setConfirmClear(true);
              }}
            >
              <TrashIcon size="0.9em" />
              {/* Two presses rather than a dialog on top of a dialog: the button says what it is
                  about to do, and a click anywhere else takes the offer back. */}
              {confirmClear ? t("rest.historyClearConfirm") : t("rest.historyClear")}
            </Button>
          </div>

          {shown.length === 0 ? (
            <p className={`${styles.note} muted`}>
              {history.length === 0 ? t("rest.historyEmpty") : t("rest.historyNoMatch")}
            </p>
          ) : (
            <ul
              className={styles.list}
              onMouseDown={() => {
                setConfirmClear(false);
                setConfirmDrop(null);
              }}
            >
              {shown.map((entry) => {
                const open = entry.id === openId;
                /* Looked up rather than remembered: nothing goes back through the file when a
                   request is deleted, so this is where an entry finds out it has been orphaned. */
                const source =
                  entry.requestId === null ? undefined : findRequest(lists, entry.requestId);
                return (
                  <li key={entry.id} className={styles.item}>
                    <div className={styles.row}>
                      <button
                        type="button"
                        className={styles.entry}
                        aria-expanded={open}
                        title={entry.url}
                        onClick={() => setOpenId(open ? null : entry.id)}
                      >
                        <span className={styles.line}>
                          <span className={`${styles.method} rest-method rest-method-${entry.method}`}>
                            {entry.method}
                          </span>
                          <span className={styles.url}>{entry.url}</span>
                        </span>
                        <span className={styles.meta}>
                          <span>{when.format(entry.startedAt)}</span>
                          {entry.envName !== "" && <span>{entry.envName}</span>}
                          <span>{t("rest.duration", { ms: entry.durationMs })}</span>
                          {entry.status === null ? (
                            <span className={styles.failed}>{t("rest.historyFailed")}</span>
                          ) : (
                            <>
                              <span className={statusClass(entry.status)}>
                                {entry.status} {entry.statusText}
                              </span>
                              <span>{formatBytes(entry.size)}</span>
        </>
                        )}
                      </span>
                    </button>
                    {/* One send forgotten rather than the whole list: the history fills with
                        attempts at the same call, and dropping them as they are recognised is what
                        keeps it readable. */}
                    <button
                      type="button"
                      className={
                        confirmDrop === entry.id ? `${styles.drop} ${styles.dropArmed}` : styles.drop
                      }
                      title={
                        confirmDrop === entry.id
                          ? t("rest.historyDropConfirm")
                          : t("rest.historyDrop")
                      }
                      aria-label={t("rest.historyDrop")}
                      // The list disarms on mouse-down, which lands before this button's click and
                      // would clear the arming in time for the confirming press to miss it.
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (confirmDrop !== entry.id) {
                          setConfirmDrop(entry.id);
                          return;
                        }
                        setConfirmDrop(null);
                        forgetEntry(entry.id);
                      }}
                    >
                      <TrashIcon size="0.9em" />
                    </button>
                  </div>

                  {open && (
                    <div className={styles.detail}>
                      {entry.error === null ? body(entry) : <p className={styles.error}>{entry.error}</p>}
                      {source === undefined ? (
                        <p className={`${styles.note} muted`}>{t("rest.historyRequestGone")}</p>
                      ) : (
                        <Button
                          size="small"
                          className={styles.openRequest}
                          onClick={() => {
                            onOpenRequest(source.id);
                            close(onClose);
                          }}
                        >
                          {t("rest.historyOpenRequest")}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        </>
      )}
    </Modal>
  );
}

export default HistoryDialog;

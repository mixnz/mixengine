import { CloseIcon } from "../../../icons";
import { useTranslation } from "../../../i18n";
import styles from "./TabNotice.module.css";

interface Props {
  /** Already translated — this draws a sentence and does not compose one. */
  message: string;
  onDismiss: () => void;
}

/**
 * One line at the top of a tab, about the tab.
 *
 * `role="status"` and not `role="alert"`: nothing failed and nothing is interrupted — this says
 * that the window changed shape on the way to opening this tab (T110's D2). No timer either;
 * `ErrorBanner`'s sixty seconds are there because an error stops being news, and this stays true
 * until someone acts on it.
 */
function TabNotice({ message, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <p className={styles.notice} role="status">
      <span>{message}</span>
      <button
        type="button"
        className={styles.dismiss}
        aria-label={t("profiles.turnedOnDismiss")}
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </p>
  );
}

export default TabNotice;

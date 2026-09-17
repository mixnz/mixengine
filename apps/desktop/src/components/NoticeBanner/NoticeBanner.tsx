import { CloseIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import styles from "./NoticeBanner.module.css";

interface Props {
  message: string;
  /** Omitted where the notice belongs to a dialog that closes on its own. */
  onDismiss?: () => void;
}

/**
 * Something worth knowing that stops nothing — a warning-tone inset panel.
 *
 * Unlike `ErrorBanner` it never dismisses itself: nothing failed, so there is no moment after which
 * it stops being true, and a countdown would suggest the thing it says had expired.
 */
function NoticeBanner({ message, onDismiss }: Props) {
  const { t } = useTranslation();

  return (
    /* `status` and not `alert`: nothing the person expected has gone wrong, so a screen reader says
       this at the next pause rather than interrupting. */
    <p className={styles.banner} role="status">
      {message}
      {onDismiss && (
        <button
          type="button"
          className={styles.dismiss}
          aria-label={t("noticeBanner.dismiss")}
          onClick={onDismiss}
        >
          <CloseIcon />
        </button>
      )}
    </p>
  );
}

export default NoticeBanner;

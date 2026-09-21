import Button from "../../../components/Button";
import { CloseIcon } from "../../../icons";
import { useTranslation } from "../../../i18n";
import { daysUntil } from "../../sync/closing";
import styles from "./ClosingStrip.module.css";

interface Props {
  server: string;
  /** Seconds. */
  closingOn: number;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * The signed-in server's announced end, once it is near (D4b): one line across the window under
 * the tab bar, because it is about the account and not about any tab. `status`, not `alert` —
 * nothing has failed, and nothing will be refused on the day.
 */
function ClosingStrip({ server, closingOn, onOpen, onDismiss }: Props) {
  const { t, lang } = useTranslation();
  const days = daysUntil(closingOn, Date.now());
  const date = new Date(closingOn * 1000).toLocaleDateString(lang);
  return (
    <div className={styles.strip} role="status">
      <span className={styles.text}>
        {days > 0 ? t("sync.closingSoon", { server, days, date }) : t("sync.closingNow", { server, date })}
      </span>
      <Button size="small" variant="soft" onClick={onOpen}>
        {t("sync.openSync")}
      </Button>
      <Button size="small" variant="ghost" onClick={onDismiss} aria-label={t("noticeBanner.dismiss")}>
        <CloseIcon />
      </Button>
    </div>
  );
}

export default ClosingStrip;

import { openUrl } from "@tauri-apps/plugin-opener";
import Button from "../../../../components/Button";
import { useTranslation } from "../../../../i18n";
import { selfHostingUrl } from "../../../links";
import settings from "../SettingsModal.module.css";
import styles from "./SyncSection.module.css";

/** The pane's last line, in every state: sync does not have to go through our server. */
function SelfHosting() {
  const { t, lang } = useTranslation();
  return (
    <div className={`${settings.updateRow} ${styles.selfHosting}`}>
      <span className={settings.hint}>{t("sync.selfHostingHint")}</span>
      <Button size="small" onClick={() => void openUrl(selfHostingUrl(lang))}>
        {t("sync.selfHostingGuide")}
      </Button>
    </div>
  );
}

export default SelfHosting;

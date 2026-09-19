import { useCallback, useEffect, useState } from "react";

import Checkbox from "../../../../components/Checkbox";
import { errorMessage } from "../../../../core/errors";
import { loginItemStatus, setLoginItem, type LoginItem } from "../../../../core/window";
import { useTranslation } from "../../../../i18n";
import styles from "./Settings.module.css";

/**
 * MixLab's own login entry — ADR 0042, T168f. Beside the daemon's switch and never merged into it:
 * a person may want MixEngine at login and no window, or the tray and no daemon.
 *
 * **Read on every mount.** The entry can be removed from System Settings, Task Manager or a
 * desktop's startup list without MixLab knowing, so the switch shows what is there now.
 */
export default function LoginItemSection({ onError }: { onError: (message: string) => void }) {
  const [item, setItem] = useState<LoginItem | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setItem(await loginItemStatus());
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [t, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle() {
    if (item === null) return;
    setBusy(true);
    try {
      setItem(await setLoginItem(!item.enabled));
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (item === null) return null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.loginItem.title")}</h3>
      {item.supported ? (
        <>
          <Checkbox
            className={styles.row}
            label={t("mixengine.settings.loginItem.toggle")}
            checked={item.enabled}
            disabled={busy}
            onChange={() => void toggle()}
          />
          <p className={styles.muted}>
            {item.trayHost ? t("mixengine.settings.loginItem.about") : t("mixengine.settings.loginItem.noTray")}
          </p>
        </>
      ) : (
        <p className={styles.muted}>{t("mixengine.settings.loginItem.unsupported")}</p>
      )}
    </section>
  );
}

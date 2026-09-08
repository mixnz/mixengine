import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { AutostartReport } from "../../api/types/AutostartReport";
import { autostartPresentation } from "../../settingsState";
import styles from "./Settings.module.css";

/**
 * Công tắc tự khởi động — T85b.
 *
 * **`enabled && !for_this_home` phải đọc khác `enabled && for_this_home`.** Một entry đã đăng ký
 * thuộc home khác vẫn là `enabled: true` — công tắc bật, nhưng bật cho một home không phải home
 * này. Bấm "Bật" ở đây vẫn hợp lệ (nó *thay* entry, vì chỉ có một entry mỗi user), nhưng câu hiện
 * ra không được nói "đã bật" như thể không có gì cần biết thêm.
 */
export default function AutostartSection({ onError }: { onError: (message: string) => void }) {
  const [report, setReport] = useState<AutostartReport | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setReport(await api.autostartStatus());
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [t, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle() {
    if (report === null) return;
    setBusy(true);
    try {
      setReport(report.enabled ? await api.autostartDisable() : await api.autostartEnable());
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (report === null) return null;
  const presentation = autostartPresentation(report);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.autostart.title")}</h3>

      {presentation === "unsupported" ? (
        <p className={styles.muted}>
          {t("mixengine.settings.autostart.unsupported", { location: report.location })}
        </p>
      ) : (
        <>
          <div className={styles.row}>
            <input type="checkbox" checked={report.enabled} disabled={busy} onChange={() => void toggle()} />
            <span>{t("mixengine.settings.autostart.toggle")}</span>
          </div>
          {presentation === "enabledOtherHome" && (
            <p className={styles.warn}>{t("mixengine.settings.autostart.otherHome")}</p>
          )}
          <p className={styles.muted}>
            {t("mixengine.settings.autostart.location", { location: report.location })}
          </p>
        </>
      )}
    </section>
  );
}

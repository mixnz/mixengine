import { useCallback, useEffect, useId, useState } from "react";

import Switch from "../../../../components/Switch";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import styles from "./Settings.module.css";

/**
 * "Save battery" — T167b, ADR 0041.
 *
 * **Tắt trừ khi người dùng bật.** Khi tắt, MixEngine không dừng service nào chỉ vì nó rảnh: một site
 * đang chạy thì cứ chạy. Khi bật, pool PHP rảnh nửa tiếng và database/cache rảnh một tiếng sẽ được
 * dừng, và request kế tiếp cần tới sẽ bật lại — câu dưới công tắc nói đúng điều người dùng sẽ thấy:
 * lần tải đầu có thể chậm một nhịp.
 *
 * `Switch` chứ không phải `Checkbox` như mục Autostart bên cạnh: đây là một cài đặt có hiệu lực
 * ngay khi bấm, đúng thứ `Switch` dành cho.
 */
export default function SaveResourcesSection({ onError }: { onError: (message: string) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setOn((await api.saveResources()).on);
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [t, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function change(next: boolean) {
    setBusy(true);
    try {
      setOn((await api.setSaveResources(next)).on);
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (on === null) return null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.saveResources.title")}</h3>
      <div className={styles.row}>
        <Switch
          checked={on}
          disabled={busy}
          aria-labelledby={labelId}
          onChange={(next) => void change(next)}
        />
        <span id={labelId}>{t("mixengine.settings.saveResources.toggle")}</span>
      </div>
      <p className={styles.muted}>
        {on ? t("mixengine.settings.saveResources.on") : t("mixengine.settings.saveResources.off")}
      </p>
      {on && <p className={styles.muted}>{t("mixengine.settings.saveResources.keepWarm")}</p>}
    </section>
  );
}

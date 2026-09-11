import { useCallback, useEffect, useState } from "react";

import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import styles from "./AutostartPanel.module.css";

/**
 * Service này có khởi động cùng MixEngine không — T114.
 *
 * **Một công tắc, không nút Save**, khác `IdlePanel` ngay bên cạnh: idle có ba trạng thái và một
 * con số phải gõ, nên nó cần một lần xác nhận; đây là một cột boolean, và một công tắc phải bấm
 * thêm "Lưu" là một công tắc người ta tưởng đã bật.
 *
 * **Đặt cạnh idle và có một dòng giữa hai cái.** Hai cài đặt trả lời hai câu khác nhau — "khi tôi
 * ngồi xuống thì cái gì đang chạy" và "khi tôi không dùng thì cái gì còn chạy" — và một service bật
 * cả hai sẽ khởi động lúc đăng nhập rồi bị dừng khi không ai dùng. Đó là đúng, và cũng đúng là thứ
 * người ta sẽ đọc thành lỗi, nên câu giải thích nằm ngay đây thay vì trong tài liệu.
 */
export default function AutostartPanel({ service }: { service: string }) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  // Đọc từ `service.list` chứ không phải một method đọc riêng: `ServiceSummary` đã mang sẵn cột
  // này (T112), nên thêm một command backend nữa chỉ để hỏi một service là thêm một chỗ để lệch.
  const reload = useCallback(async () => {
    try {
      const list = await api.services();
      const mine = list.services.find((summary) => summary.id === service);
      setAutostart(mine?.autostart ?? null);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [service, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(wanted: boolean) {
    setBusy(true);
    setError("");
    try {
      const summary = await api.serviceSetAutostart({ service, autostart: wanted });
      // Thứ daemon trả về, không phải thứ vừa bấm: một công tắc nói dối về cột trong database tệ
      // hơn một công tắc chậm — cùng luật bảng service ở Dashboard đang theo.
      setAutostart(summary.autostart);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.panel}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <h4>{t("mixengine.servicesDetail.autostart.title")}</h4>

      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={autostart === true}
          disabled={busy || autostart === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {t("mixengine.servicesDetail.autostart.toggle")}
      </label>

      <p className={styles.note}>{t("mixengine.servicesDetail.autostart.dependencies")}</p>
      <p className={styles.note}>{t("mixengine.servicesDetail.autostart.versusIdle")}</p>
    </div>
  );
}

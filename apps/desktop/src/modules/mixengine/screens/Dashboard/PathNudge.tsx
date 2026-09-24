import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { PathReport } from "@mixengine/api";
import { shouldOfferPathInstall } from "../../pathState";
import styles from "./PathNudge.module.css";

/**
 * Nhắc đưa `<root>/bin` vào PATH, cho người vừa cài app mà chưa từng gõ `mix path install`.
 *
 * **Chỉ vẽ khi `on_path: false`, và biến mất bằng cách xong việc** — như thẻ Quick Start, không có
 * nút "Ẩn" hay cờ đã lưu. Sau khi cài, thẻ ở lại với một câu "mở terminal mới", vì đó là điều người
 * dùng cần biết tiếp theo; lần mở tab sau nó không còn nữa.
 *
 * Đọc `path.status` hỏng thì im lặng: một Dashboard đỏ vì một lời nhắc là một Dashboard đỏ vì một
 * câu trang trí. Bật/tắt đầy đủ, kèm báo lỗi, nằm ở Settings.
 *
 * **Read again each time Dashboard comes back to the front**, not once at mount: Dashboard stays
 * mounted after its first visit (`mountedScreens`), so a switch flipped in Settings, or a
 * `mix path install` in a terminal, would otherwise never reach this card. The "open a new
 * terminal" line goes with the same reading, which is what "gone the next time" means here.
 */
export default function PathNudge({ active }: { active: boolean }) {
  const [report, setReport] = useState<PathReport | null>(null);
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  useEffect(() => {
    if (!active) return;
    let live = true;
    api
      .pathStatus()
      .then((next) => {
        if (!live) return;
        setReport(next);
        setDone(false);
      })
      .catch(() => {
        // Để nguyên report cũ: không biết thì không đổi gì.
      });
    return () => {
      live = false;
    };
  }, [active]);

  async function install() {
    setInstalling(true);
    try {
      await api.pathInstall();
      setDone(true);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setInstalling(false);
    }
  }

  if (!done && !shouldOfferPathInstall(report)) return null;

  return (
    <section className={styles.card}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <h3 className={styles.title}>{t("mixengine.pathNudge.title")}</h3>
      {done ? (
        <p className={styles.intro}>{t("mixengine.pathNudge.done")}</p>
      ) : (
        <div className={styles.row}>
          <p className={styles.intro}>{t("mixengine.pathNudge.intro")}</p>
          <Button
            variant="soft"
            busy={installing ? t("mixengine.pathNudge.installing") : undefined}
            onClick={() => void install()}
          >
            {t("mixengine.pathNudge.install")}
          </Button>
        </div>
      )}
    </section>
  );
}

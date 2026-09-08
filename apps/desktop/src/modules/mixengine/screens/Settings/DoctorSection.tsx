import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DoctorReport } from "../../api/types/DoctorReport";
import ElevationDialog from "../../components/ElevationDialog";
import { isJobFinished, needsResync } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import { doctorChecksInOrder } from "../../settingsState";
import styles from "./Settings.module.css";

/**
 * `daemon.doctor` + `daemon.doctor_repair`.
 *
 * **Sửa dùng lại đúng hàng đợi `elevation.status`/`ElevationDialog` Dashboard đã dựng ở Pha 1**
 * (Quyết định D3, spec Metrics/Settings) — không viết dialog elevation thứ hai. Gọi
 * `doctorRepair({ grant: false })` xong, đọc `elevation.status`: có gì chờ thì mở đúng dialog đó;
 * không có gì (sửa nằm trong `MIXENGINE_HOME` không cần quyền) thì chỉ đọc lại report.
 *
 * **Report được đọc lại mỗi lần quay lại màn này và mỗi khi một job kết thúc**, không chỉ lúc
 * mount. `MixEngineTab` giữ mọi màn đã mở trong DOM thay vì unmount, nên "mount" chỉ xảy ra một lần
 * cho cả đời tab — một report đọc đúng một lần đứng yên tới khi đóng hẳn tab MixEngine, dù người
 * dùng vừa cấp quyền ở Dashboard (nút "N đang chờ") hay từ CLI. Một `elevation.grant` xong là một
 * `job_finished`, và daemon không phát sự kiện nào riêng cho "hàng đợi vừa ngắn đi" (xem
 * `isJobFinished`), nên đó là tín hiệu để đọc lại; `active` là đường dự phòng khi sự kiện rơi.
 */
export default function DoctorSection({
  active,
  onError,
}: {
  active: boolean;
  onError: (message: string) => void;
}) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [pending, setPending] = useState<unknown[] | null>(null);
  const [canPrompt, setCanPrompt] = useState(true);
  const [reason, setReason] = useState<string | null | undefined>(null);
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setReport(await api.doctor());
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [t, onError]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      if (isJobFinished(raw) || needsResync(raw)) void reload();
    });
  }, [reload]);

  async function repair() {
    setRepairing(true);
    try {
      await api.doctorRepair({ grant: false });
      const queue = await api.elevationStatus();
      if (queue.pending.length > 0) {
        setCanPrompt(queue.can_prompt);
        setReason(queue.reason);
        setPending(queue.pending);
      } else {
        await reload();
      }
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setRepairing(false);
    }
  }

  if (report === null) return null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.doctor.title")}</h3>

      <ul className={styles.list}>
        {doctorChecksInOrder(report).map((check, index) => (
          // Vị trí là khoá: report không có id nào khác, và thứ tự cố định là chính điều đang test.
          <li key={index} className={styles.listItem}>
            <span>{check.name}</span>
            <span
              className={
                check.outcome.outcome === "ok"
                  ? styles.ok
                  : check.outcome.outcome === "problem"
                    ? styles.bad
                    : styles.muted
              }
            >
              {check.outcome.outcome === "ok"
                ? t("mixengine.settings.doctor.ok")
                : "because" in check.outcome
                  ? check.outcome.because
                  : ""}
            </span>
          </li>
        ))}
      </ul>

      <Button onClick={() => void repair()} disabled={repairing}>
        {t("mixengine.settings.doctor.repair")}
      </Button>

      {pending && (
        <ElevationDialog
          pending={pending}
          canPrompt={canPrompt}
          reason={reason}
          onClose={() => {
            setPending(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

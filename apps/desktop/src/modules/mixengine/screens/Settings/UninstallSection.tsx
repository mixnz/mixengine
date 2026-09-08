import { useCallback, useEffect, useRef, useState } from "react";

import Button from "../../../../components/Button";
import type { AppError } from "../../../../core/errors";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { Error as WireError } from "../../api/types/Error";
import type { JobSummary } from "../../api/types/JobSummary";
import type { Residue } from "../../api/types/Residue";
import type { UninstallReport } from "../../api/types/UninstallReport";
import styles from "./Settings.module.css";
import UninstallConfirmDialog from "./UninstallConfirmDialog";
import { useRunningDots } from "./useRunningDots";

/** `JobOutcome`'s `error` thành `AppError` dịch được — cùng khuôn `refusal()` của `runtimeState.ts`,
 *  viết lại vì `error` ở đây đã có kiểu (`WireError`), không phải `unknown` từ một event thô. */
function refusal(error: WireError): AppError {
  const params: Record<string, string> = { code: error.code, message: error.message };
  if (error.hint) params.hint = error.hint;
  return { code: "error.mixengineRefused", params };
}

/**
 * `daemon.uninstall_plan` trước và luôn luôn, rồi `daemon.uninstall` — T87.
 *
 * **Đổi `keep_home` gọi lại plan**, không tự suy luận dòng nào đổi: `uninstall_plan` là một đọc
 * thuần, daemon là nơi duy nhất biết đường dẫn nào bị ảnh hưởng bởi cờ đó.
 *
 * **`UninstallConfirmDialog` chặn trước `grant: true`** — đúng tinh thần T64 (đọc trước khi cho
 * phép) dù `daemon.uninstall` không đi qua hàng đợi `elevation.status` như `doctor_repair` (nó tự
 * gộp enqueue-và-cấp-quyền vào một job, xem doc-comment `UninstallReport`). Không còn dựa vào bấm
 * hai lượt trên cùng một nút — nút đổi tên đứng yên nhưng lần bấm thứ hai xảy ra trong một dialog
 * riêng, tránh UAC/mật khẩu hệ điều hành bật lên mà chưa ai chạm gì có chủ đích ở tầng app.
 *
 * **`onUninstalled` — cùng cơ chế `onApplied` của `UpdatesSection`/`update.apply` (xem
 * `MixEngineTab.pollUntilDaemonLeaves`).** `daemon.uninstall` với `keep_home: false` cũng tự kết
 * thúc chính daemon đang phục vụ request đó — một "Đã gỡ MixEngine." đứng yên trong Settings không
 * đủ, vì phần còn lại của app (Dashboard, Sites…) vẫn tưởng daemon còn sống cho tới khi có ai gọi lại
 * `presence`.
 *
 * **Job `"succeeded"` KHÔNG có nghĩa là "đã gỡ" — `UninstallReport` trong `outcome.result` mới là
 * câu trả lời.** Theo ADR 0005 của MixEngine, một prompt bị từ chối (đóng UAC, bấm Huỷ trên hộp mật
 * khẩu) là một kết quả bình thường, không phải lỗi: daemon vẫn ghi job `"succeeded"`, nhưng trong
 * report các dòng cần quyền admin đứng ở `enqueued`, dòng `home` là `kept`, và không arm thư mục nào
 * — nên daemon **ở lại** (`uninstall_now`, T87 D9: "a declined grant arms nothing, the daemon stays
 * up"). Suy "succeeded + `keep_home: false` ⇒ daemon sắp thoát" rồi gọi `onUninstalled()` từng là bug
 * thật: `pollUntilDaemonLeaves` poll `presence` mãi mà daemon không đi đâu, `job` không bao giờ
 * được xoá, chữ "Đang gỡ…" kẹt vĩnh viễn. `pollJob` vì thế đọc report:
 *
 * - có dòng `on_exit` → daemon đã arm home và sắp tự thoát → `onUninstalled()`, giữ "Đang gỡ…" tới
 *   khi gate phía trên tự vẽ màn đúng;
 * - `keepHome` và không dòng nào còn `enqueued`/`failed` → xong thật, `setDone(true)`;
 * - còn lại (prompt bị từ chối, hoặc gỡ dở) → xoá `job` để nút "Uninstall MixEngine" hiện lại ngay,
 *   `setPlan(report)` để danh sách hiện đúng từng dòng đã xoá / còn chờ quyền, và một dòng
 *   `declined` nói rõ chưa có gì cần quyền admin bị xoá — bấm lại là daemon hỏi lại cùng prompt đó.
 *
 * **`"failed"`/`"cancelled"`** (lỗi thật của job, hay `job.cancel` từ nơi khác) cũng chỉ xoá `job`
 * — daemon không tự thoát vì job hỏng, không có gì để giao lại cho gate.
 *
 * **`jobStatus` tự ném lỗi** cũng cần phân theo `keepHome`: đúng lúc `keep_home: false` khiến daemon
 * tự thoát giữa chừng, kết nối RPC rơi trông giống một lỗi nhưng lại là dấu hiệu daemon đã rời (đúng
 * luật "daemon chết là một trạng thái đọc được" đã theo từ Pha 1) — chỉ khi `keep_home: true`, nơi
 * daemon không có lý do gì để mất kết nối, mới coi đó là một lỗi thật.
 */
export default function UninstallSection({
  onError,
  onUninstalled,
}: {
  onError: (message: string) => void;
  onUninstalled: () => void;
}) {
  const [keepHome, setKeepHome] = useState(true);
  const [plan, setPlan] = useState<UninstallReport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [done, setDone] = useState(false);
  /** Lượt gỡ vừa rồi kết thúc mà không được cấp quyền (xem doc-comment đầu file) — tắt ở lượt sau. */
  const [declined, setDeclined] = useState(false);
  const dots = useRunningDots(job !== null);
  const { t } = useTranslation();
  /** Còn mount hay không — đặt lại `true` trong thân effect, không chỉ `false` trong cleanup:
   *  `React.StrictMode` (dev) chạy mount → unmount giả → mount lại, và một ref chỉ được hạ xuống
   *  `false` sẽ ở đó vĩnh viễn, khiến mọi vòng `pollJob` thoát ngay ở guard mà không bao giờ
   *  cập nhật `job` — "Đang gỡ…" kẹt trong dev dù daemon đã trả lời xong. */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reloadPlan = useCallback(async () => {
    try {
      setPlan(await api.uninstallPlan({ keep_home: keepHome, grant: false }));
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [keepHome, t, onError]);

  useEffect(() => {
    void reloadPlan();
  }, [reloadPlan]);

  async function pollJob(id: number) {
    let summary: JobSummary;
    try {
      summary = await api.jobStatus(id);
    } catch (e) {
      if (!live.current) return;
      if (keepHome) {
        // Daemon không có lý do gì để mất kết nối khi `keep_home: true` — một lỗi thật.
        onError(errorMessage(t, e));
      } else {
        // `jobStatus` mất kết nối đúng lúc daemon tự thoát (`keep_home: false`) trông giống một lỗi
        // RPC, nhưng đây chính là dấu hiệu daemon đã rời — cùng luật "daemon chết là một trạng thái
        // đọc được", giao thẳng cho gate trên cùng thay vì báo lỗi.
        onUninstalled();
      }
      return;
    }
    if (!live.current) return;
    if (summary.state === "running") {
      setJob(summary);
      setTimeout(() => void pollJob(id), 1000);
      return;
    }
    if (summary.state !== "succeeded") {
      // "failed" hoặc "cancelled" — vd. người dùng bấm Huỷ trên UAC/mật khẩu quản trị thay vì gõ nó
      // vào. Job tự bật prompt bên trong chính nó (theo doc-comment `UninstallReport`); một prompt bị
      // từ chối chỉ làm JOB đó hỏng, daemon không hề tự thoát — không có gì để `onUninstalled()` giao
      // lại, và giữ `job` khác `null` sẽ làm "Đang gỡ…" kẹt vĩnh viễn dù không còn gì đang chạy. Xoá
      // `job` để nút "Uninstall MixEngine" hiện lại, bấm được ngay.
      setJob(null);
      if (summary.outcome?.ending === "failed") {
        onError(errorMessage(t, refusal(summary.outcome.error)));
      }
      return;
    }
    // "succeeded" chỉ nói job đã ghi xong report — report mới nói gỡ được tới đâu (doc-comment đầu
    // file). `outcome` luôn khác null khi job đã kết thúc (doc-comment `JobSummary.outcome`).
    const report =
      summary.outcome?.ending === "succeeded"
        ? (summary.outcome.result as UninstallReport)
        : null;
    if (report === null) {
      setJob(null);
      return;
    }
    setPlan(report);
    const armed = report.items.some((item) => item.outcome.removal === "on_exit");
    const unfinished = report.items.some(
      (item) => item.outcome.removal === "enqueued" || item.outcome.removal === "failed",
    );
    if (armed) {
      // Daemon đã arm home và sắp tự thoát — giữ "Đang gỡ…" tới khi gate phía trên vẽ màn đúng.
      setJob(summary);
      onUninstalled();
      return;
    }
    setJob(null);
    if (keepHome && !unfinished) {
      setDone(true);
      return;
    }
    // Prompt bị từ chối (đóng UAC) hoặc gỡ dở: daemon ở lại, hàng đợi vẫn giữ các thao tác cần
    // quyền — bấm "Uninstall MixEngine" lại là hỏi lại đúng prompt đó.
    setDeclined(true);
  }

  async function startUninstall() {
    const summary = await api.uninstall({ keep_home: keepHome, grant: true });
    setDeclined(false);
    setJob(summary);
    setConfirmOpen(false);
    void pollJob(summary.id);
  }

  function residueRow(item: Residue) {
    const { outcome } = item;
    // Câu thật của daemon khi có (`how`/`what`/`because`), tên biến thể khi outcome không mang câu
    // nào (`absent`, `removed` không kèm `what` trong bản build này) — không bao giờ để trống.
    const detail =
      "how" in outcome
        ? outcome.how
        : "what" in outcome
          ? outcome.what
          : "because" in outcome
            ? outcome.because
            : outcome.removal;
    return (
      <li key={item.id} className={styles.listItem}>
        <span>{item.what}</span>
        <span className={styles.muted}>{detail}</span>
      </li>
    );
  }

  if (done) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("mixengine.settings.uninstall.title")}</h3>
        <p>{t("mixengine.settings.uninstall.done")}</p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.uninstall.title")}</h3>

      <label className={styles.row}>
        <input
          type="checkbox"
          checked={keepHome}
          disabled={job !== null}
          onChange={(e) => setKeepHome(e.target.checked)}
        />
        {t("mixengine.settings.uninstall.keepHome")}
      </label>

      {plan && <ul className={styles.list}>{plan.items.map(residueRow)}</ul>}

      {declined && job === null && (
        <p className={styles.muted}>{t("mixengine.settings.uninstall.declined")}</p>
      )}

      {job !== null ? (
        <p className={styles.muted}>
          {t("mixengine.settings.uninstall.running")}
          {dots}
          {job.message && ` ${job.message}`}
        </p>
      ) : (
        <Button className={styles.danger} onClick={() => setConfirmOpen(true)}>
          {t("mixengine.settings.uninstall.start")}
        </Button>
      )}

      {confirmOpen && (
        <UninstallConfirmDialog
          onConfirm={startUninstall}
          onError={onError}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}

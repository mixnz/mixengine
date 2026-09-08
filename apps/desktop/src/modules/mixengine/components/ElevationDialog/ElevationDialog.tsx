import { useEffect, useRef, useState } from "react";

import Button from "../../../../components/Button";
import Modal from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { GrantOutcome } from "../../api/types/GrantOutcome";
import type { JobSummary } from "../../api/types/JobSummary";
import { describeOp } from "../../pendingOps";
import { useRunningDots } from "../../screens/Settings/useRunningDots";
import styles from "./ElevationDialog.module.css";

/**
 * Mọi thao tác đang chờ quyền quản trị, rồi một prompt.
 *
 * Danh sách hiện **trước** khi `elevation.grant` được gọi, vì thứ người ta sắp cho phép là thứ họ
 * được xem. Mỗi hàng nêu thao tác và, khi có, đúng những gì nó sẽ đổi — không dịch, vì đó là đường
 * dẫn và cổng thật.
 *
 * **`canPrompt: false` ẩn hẳn nút "Cho phép"**, không chỉ khoá nó — `ElevationSummary.can_prompt`
 * nói thẳng "helper còn đó không", và trên máy không còn helper (ví dụ vừa Uninstall MixEngine trên
 * macOS: helper nằm ngoài `MIXENGINE_HOME`, bị lệnh Uninstall xoá cùng lúc, nhưng một `hosts-apply`
 * cũ có thể vẫn còn kẹt trong hàng đợi elevation từ trước) thì `elevation.grant` không còn gì để gọi
 * — một nút "Cho phép" vẫn vẽ ra trong tình huống đó là hứa một việc app không làm được. `reason`
 * là câu daemon tự viết cho từng nền tảng (vd. Linux: nguyên câu lệnh `pkexec` để gõ tay).
 *
 * **Không có nút "Bỏ qua".** `elevation.drop` bỏ cả lô mà không để lại cách nào cấp lại — đóng hộp
 * thoại (Escape, bấm ra ngoài, hay nút Đóng) chỉ ẩn nó đi, số đang chờ ở Dashboard vẫn còn nguyên
 * và bấm lại mở ra đúng danh sách này.
 *
 * **`elevation.grant` là một job, và dialog chờ job đó xong mới đóng.** RPC trả lời ngay khi hàng
 * job được tạo, còn hộp mật khẩu bật lên *sau đó* bên trong job — đóng dialog ngay khi RPC trả lời
 * từng là bug thật: `onClose` kéo `reload()` của Dashboard đọc `daemon.status` đúng lúc hàng đợi
 * vẫn còn nguyên (người dùng chưa gõ mật khẩu), và sau khi gõ xong daemon không phát sự kiện nào
 * về hàng đợi (`elevation_required` chỉ bắn khi hàng đợi *dài thêm*), nên con số "N đang chờ" đứng
 * yên tới khi ai đó đổi tab. Nên ở đây poll `jobStatus` mỗi giây tới khi job xong, rồi mới `onClose`
 * — và đọc `GrantOutcome` trong `result`: `declined` (đóng hộp mật khẩu) giữ dialog mở với một dòng
 * nói rõ chưa có gì đổi, mở lại nút Cho phép, thay vì đóng im lặng để lại con số cũ không lời giải.
 */
export default function ElevationDialog({
  pending,
  canPrompt,
  reason,
  onClose,
}: {
  pending: unknown[];
  canPrompt: boolean;
  reason?: string | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /** Kết cục của lượt Cho phép vừa rồi khi nó không dẫn tới đóng dialog — câu đã dịch, hoặc `null`. */
  const [notice, setNotice] = useState<string | null>(null);
  const dots = useRunningDots(busy);
  const { t } = useTranslation();
  /** Còn mount hay không — đặt `true` trong thân effect chứ không chỉ `false` ở cleanup, vì
   *  `React.StrictMode` (dev) chạy mount → unmount giả → mount lại (xem `UninstallSection`). */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  function settle(summary: JobSummary) {
    setBusy(false);
    if (summary.state === "cancelled") return;
    if (summary.outcome?.ending === "failed") {
      setNotice(summary.outcome.error.message);
      return;
    }
    if (summary.outcome?.ending !== "succeeded") return;
    const grant = summary.outcome.result as GrantOutcome;
    if (grant.outcome === "declined") {
      setNotice(t("mixengine.elevation.declined"));
      return;
    }
    if (grant.outcome === "unavailable") {
      setNotice(t("mixengine.elevation.cannotPromptReason", { reason: grant.reason }));
      return;
    }
    // `completed` — hàng đợi đã khác; Dashboard đọc lại con số trong `onClose`.
    onClose();
  }

  async function pollJob(id: number) {
    let summary: JobSummary;
    try {
      summary = await api.jobStatus(id);
    } catch (e) {
      if (!live.current) return;
      setBusy(false);
      setNotice(errorMessage(t, e));
      return;
    }
    if (!live.current) return;
    if (summary.state === "running") {
      setTimeout(() => void pollJob(id), 1000);
      return;
    }
    settle(summary);
  }

  async function grant() {
    setBusy(true);
    setNotice(null);
    let started: JobSummary;
    try {
      started = await api.elevationGrant();
    } catch (e) {
      if (!live.current) return;
      setBusy(false);
      setNotice(errorMessage(t, e));
      return;
    }
    if (!live.current) return;
    void pollJob(started.id);
  }

  return (
    <Modal
      label={t("mixengine.elevation.title")}
      onClose={onClose}
      locked={busy}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h2 className={styles.title}>{t("mixengine.elevation.title")}</h2>
          <p>{t("mixengine.elevation.lead")}</p>
          <ul className={styles.ops}>
            {pending.map((op, at) => {
              const { kind, description, detail } = describeOp(op);
              return (
                // Vị trí là khoá: `PendingOp.id` có tồn tại, nhưng thứ tự là thứ daemon gửi và danh
                // sách không sắp xếp lại, nên hai cách cho cùng một kết quả và cách này không phải
                // tin vào một field.
                <li key={at}>
                  {/* Câu của daemon đứng trước; tên kỹ thuật đứng sau, cho người muốn tra cứu nó. */}
                  {description && <div>{description}</div>}
                  <code className={styles.kind}>{kind}</code>
                  {detail && <pre className={styles.detail}>{detail}</pre>}
                </li>
              );
            })}
          </ul>
          {!canPrompt && (
            <p className={styles.cannotPrompt}>
              {reason
                ? t("mixengine.elevation.cannotPromptReason", { reason })
                : t("mixengine.elevation.cannotPrompt")}
            </p>
          )}
          {notice !== null && !busy && <p className={styles.cannotPrompt}>{notice}</p>}
          <div className={styles.buttons}>
            {busy && (
              <span className={styles.prompting}>
                {t("mixengine.elevation.prompting")}
                {dots}
              </span>
            )}
            <Button size="large" onClick={() => close(onClose)} disabled={busy}>
              {t("common.close")}
            </Button>
            {canPrompt && (
              <Button size="large" variant="primary" onClick={() => void grant()} disabled={busy}>
                {t("mixengine.elevation.grant")}
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import Select from "../../../../components/Select";
import type { AppError } from "../../../../core/errors";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { Error as WireError } from "../../api/types/Error";
import type { FrontEndReport } from "../../api/types/FrontEndReport";
import type { FrontEndServer } from "../../api/types/FrontEndServer";
import type { JobSummary } from "../../api/types/JobSummary";
import type { ServiceSummary } from "../../api/types/ServiceSummary";
import ElevationDialog from "../../components/ElevationDialog";
import { isJobFinished, needsResync } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import styles from "./Settings.module.css";
import { useRunningDots } from "./useRunningDots";

/** Hai giá trị `FrontEndServer` — đúng danh sách đóng của hợp đồng, không đọc từ package nào. */
const SERVERS: FrontEndServer[] = ["caddy", "nginx"];

/** `JobOutcome.error` thành `AppError` dịch được — cùng khuôn `UninstallSection.refusal`. */
function refusal(error: WireError): AppError {
  const params: Record<string, string> = { code: error.code, message: error.message };
  if (error.hint) params.hint = error.hint;
  return { code: "error.mixengineRefused", params };
}

/** Server đang active, hay `null` khi không hàng nào là front end. `undefined` khi daemon này build
 *  trước khi `role` tồn tại (ADR 0019: member vắng mặt là "daemon cũ", không phải "chưa biết"). */
function activeFrontEnd(services: ServiceSummary[]): FrontEndServer | null | undefined {
  if (services.every((service) => service.role === undefined || service.role === null)) {
    return undefined;
  }
  for (const service of services) {
    if (service.role?.role === "front_end") return service.role.server;
  }
  return null;
}

/**
 * "Default web server" — `service.set_front_end`, T97 / ADR 0026.
 *
 * **Đọc từ `ServiceSummary.role`, không có method đọc riêng.** Hàng có `role: front_end` mang luôn
 * `server`, chính là giá trị `FrontEndSwitch.server` nhận — MixDB không map tên package sang ý nghĩa
 * (ADR 0026: "no client may map a package name to a role"). Danh sách lựa chọn là hai giá trị đóng
 * của `FrontEndServer`; server chưa cài thì daemon từ chối kèm lệnh cài trong `hint`, hiện qua
 * `errorMessage` như mọi lỗi khác, không tự kiểm tra package ở đây.
 *
 * **Ghi là một job**, không phải một setting: daemon dừng server cũ, dựng server mới, và có thể cần
 * một prompt (grant cổng 80/443 trên Linux đổi theo binary). Poll `jobStatus` như `UninstallSection`,
 * rồi đọc `FrontEndReport` trong `result` — năm `outcome` được vẽ như năm kết cục khác nhau, không
 * gộp thành "lỗi":
 *
 * - `switched`/`unchanged` → đọc lại; hiện `not_carried` (override không mang qua được — thứ trường
 *   này tồn tại để không bị nuốt im lặng) và `kept_data`.
 * - `not_granted` → cùng luồng T64 khắp app: đọc `elevation.status`, mở `ElevationDialog`. Khi dialog
 *   đóng, đọc lại hàng đợi: rỗng (đã cấp) thì tự gọi switch lại — daemon nói "allowing it and asking
 *   again works"; còn gì chờ (người dùng chỉ đóng) thì dừng ở một câu, không lặp vô hạn.
 * - `rolled_back`/`failed` → `because` màu đỏ, lựa chọn quay về server đang active.
 *
 * Không truyền `version`: daemon lấy bản mới nhất đã cài, đúng ghi chú của hợp đồng ("nobody
 * choosing a web server is choosing a patch release").
 */
export default function FrontEndSection({
  active,
  onError,
}: {
  active: boolean;
  onError: (message: string) => void;
}) {
  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [choice, setChoice] = useState<FrontEndServer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [report, setReport] = useState<FrontEndReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<unknown[] | null>(null);
  const [canPrompt, setCanPrompt] = useState(true);
  const [reason, setReason] = useState<string | null | undefined>(null);
  const dots = useRunningDots(job !== null);
  const { t } = useTranslation();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const current = services === null ? undefined : activeFrontEnd(services);

  const reload = useCallback(async () => {
    try {
      const list = await api.services();
      setServices(list.services);
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

  // Lựa chọn theo server đang active mỗi lần đọc lại — trừ lúc người dùng đã chọn khác và job đang
  // chạy, để một `reload()` giữa chừng không kéo Select về giá trị cũ.
  useEffect(() => {
    if (job === null && current !== undefined) setChoice(current ?? SERVERS[0]);
  }, [current, job]);

  async function pollJob(id: number) {
    let summary: JobSummary;
    try {
      summary = await api.jobStatus(id);
    } catch (e) {
      if (!live.current) return;
      setJob(null);
      onError(errorMessage(t, e));
      return;
    }
    if (!live.current) return;
    if (summary.state === "running") {
      setJob(summary);
      setTimeout(() => void pollJob(id), 1000);
      return;
    }
    setJob(null);
    if (summary.state !== "succeeded") {
      if (summary.outcome?.ending === "failed") {
        onError(errorMessage(t, refusal(summary.outcome.error)));
      }
      return;
    }
    if (summary.outcome?.ending !== "succeeded") return;
    const result = summary.outcome.result as FrontEndReport;
    setReport(result);
    if (result.outcome.outcome === "not_granted") {
      // Thao tác đang chờ trong hàng đợi elevation — cho xem rồi mới hỏi, T64.
      try {
        const queue = await api.elevationStatus();
        if (!live.current) return;
        if (queue.pending.length > 0) {
          setCanPrompt(queue.can_prompt);
          setReason(queue.reason);
          setPending(queue.pending);
          return;
        }
      } catch (e) {
        if (!live.current) return;
        onError(errorMessage(t, e));
      }
      setNotice(t("mixengine.settings.frontEnd.notGranted", { because: result.outcome.because }));
      return;
    }
    void reload();
  }

  async function switchTo(server: FrontEndServer) {
    setConfirming(false);
    setNotice(null);
    setReport(null);
    try {
      const started = await api.serviceSetFrontEnd({ server, grant: false });
      if (!live.current) return;
      setJob(started);
      void pollJob(started.id);
    } catch (e) {
      if (!live.current) return;
      onError(errorMessage(t, e));
    }
  }

  /** Sau `ElevationDialog`: hàng đợi rỗng là đã cấp — hỏi lại; còn gì chờ là người dùng chỉ đóng. */
  async function afterElevation() {
    setPending(null);
    try {
      const queue = await api.elevationStatus();
      if (!live.current) return;
      if (queue.pending.length === 0 && choice !== null) {
        void switchTo(choice);
        return;
      }
    } catch (e) {
      if (!live.current) return;
      onError(errorMessage(t, e));
      return;
    }
    setNotice(t("mixengine.settings.frontEnd.stillWaiting"));
  }

  if (services === null) return null;

  // Daemon build trước T97: giữ hàng này nhìn thấy được với lý do, thay vì biến mất.
  if (current === undefined) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("mixengine.settings.frontEnd.title")}</h3>
        <p className={styles.muted}>{t("mixengine.settings.frontEnd.unsupported")}</p>
      </section>
    );
  }

  const outcome = report?.outcome;
  const outcomeLine =
    outcome === undefined || outcome.outcome === "not_granted"
      ? null
      : outcome.outcome === "unchanged"
        ? t("mixengine.settings.frontEnd.unchanged", { server: report?.now ?? "" })
        : outcome.outcome === "switched"
          ? t(
              outcome.started
                ? "mixengine.settings.frontEnd.switched"
                : "mixengine.settings.frontEnd.switchedNotStarted",
              { server: report?.now ?? "" },
            )
          : outcome.outcome === "rolled_back"
            ? t("mixengine.settings.frontEnd.rolledBack", { because: outcome.because })
            : t("mixengine.settings.frontEnd.failed", { because: outcome.because });
  const outcomeBad = outcome?.outcome === "rolled_back" || outcome?.outcome === "failed";

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.frontEnd.title")}</h3>

      <p className={styles.muted}>
        {current === null
          ? t("mixengine.settings.frontEnd.none")
          : t("mixengine.settings.frontEnd.current", { server: current })}
      </p>

      <div className={styles.row}>
        <Select
          value={choice ?? SERVERS[0]}
          onChange={setChoice}
          disabled={job !== null}
          options={SERVERS.map((server) => ({ value: server, label: server }))}
        />
        {job !== null ? (
          <span className={styles.muted}>
            {t("mixengine.settings.frontEnd.switching")}
            {dots}
            {job.message && ` ${job.message}`}
          </span>
        ) : (
          <Button
            variant="primary"
            disabled={choice === null || choice === current}
            onClick={() => setConfirming(true)}
          >
            {t("mixengine.settings.frontEnd.switch")}
          </Button>
        )}
      </div>

      {notice !== null && <p className={styles.warn}>{notice}</p>}

      {outcomeLine !== null && (
        <p className={outcomeBad ? styles.bad : styles.muted}>{outcomeLine}</p>
      )}
      {report && !report.answering && report.now && (
        <p className={styles.warn}>{t("mixengine.settings.frontEnd.notAnswering")}</p>
      )}
      {report?.kept_data && (
        <p className={styles.muted}>
          {t("mixengine.settings.frontEnd.keptData", { path: report.kept_data })}
        </p>
      )}
      {report && report.not_carried.length > 0 && (
        <>
          <p className={styles.warn}>{t("mixengine.settings.frontEnd.notCarried")}</p>
          <ul className={styles.list}>
            {report.not_carried.map((line, index) => (
              // Vị trí là khoá: mỗi dòng là một câu daemon viết, không có id nào khác.
              <li key={index} className={styles.muted}>
                {line}
              </li>
            ))}
          </ul>
        </>
      )}

      {confirming && choice !== null && (
        <ConfirmDialog
          title={t("mixengine.settings.frontEnd.confirmTitle")}
          message={
            current === null
              ? t("mixengine.settings.frontEnd.confirmFirst", { to: choice })
              : t("mixengine.settings.frontEnd.confirmSwitch", { from: current, to: choice })
          }
          confirmLabel={t("mixengine.settings.frontEnd.switch")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void switchTo(choice)}
        />
      )}

      {pending && (
        <ElevationDialog
          pending={pending}
          canPrompt={canPrompt}
          reason={reason}
          onClose={() => void afterElevation()}
        />
      )}
    </section>
  );
}

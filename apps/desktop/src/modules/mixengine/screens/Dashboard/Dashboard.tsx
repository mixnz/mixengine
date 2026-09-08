import { useCallback, useEffect, useState } from "react";

import ContextMenu from "../../../../components/ContextMenu";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DaemonStatus } from "../../api/types/DaemonStatus";
import type { DiskUsage } from "../../api/types/DiskUsage";
import ElevationDialog from "../../components/ElevationDialog";
import ServiceForm from "../../components/ServiceForm";
import {
  applyEvent,
  applyJob,
  isJobFinished,
  needsResync,
  rowsFrom,
  type JobRow,
  type ServiceRow,
} from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import type { MetricsFrame } from "../../api/types/MetricsFrame";
import {
  DAEMON_SUBJECT,
  formatBytes,
  formatPercent,
  metricsSubjectFor,
  parseMetricsFrame,
  readingFor,
} from "../../metricsState";
import { pendingFrom } from "../../pendingOps";
import { serviceStateKey, serviceStateTone, toggleMode } from "../../serviceStateLabel";
import CleanupDialog from "./CleanupDialog";
import DiskUsagePanel from "./DiskUsagePanel";
import styles from "./Dashboard.module.css";

/* Bảng tra tường minh chứ không ghép `${action}ing`: "stop" + "ing" ra "stoping", và một khoá dịch
   dựng bằng phép nối chuỗi là một khoá không ai grep ra được. */
const PENDING_LABEL = {
  start: "mixengine.dashboard.starting",
  stop: "mixengine.dashboard.stopping",
  restart: "mixengine.dashboard.restarting",
} as const;

/**
 * Daemon, và mọi thứ nó đang giám sát.
 *
 * **Trạng thái đến từ stream, không từ suy đoán.** Bấm Start thì hàng đó chuyển sang `starting` khi
 * `service_state_changed` nói vậy, không phải ngay lúc bấm — một công tắc nói dối về việc MariaDB
 * có đang chạy hay không tệ hơn một công tắc chậm.
 */
export default function Dashboard({ active }: { active: boolean }) {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [pending, setPending] = useState<unknown[] | null>(null);
  /** `ElevationStatus.can_prompt`/`reason` — "còn helper để bật prompt không, và tại sao không khi
   *  không". Mặc định `true` vì đa số máy bật prompt được; chỉ đổi khi `elevation.status` nói khác. */
  const [canPrompt, setCanPrompt] = useState(true);
  const [reason, setReason] = useState<string | null | undefined>(null);
  /** Có bao nhiêu thao tác chờ quyền, theo `daemon.status`. Chỉ là con số; danh sách ở `elevation.status`. */
  const [waiting, setWaiting] = useState(0);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  /** Frame mới nhất của `/metrics`, hoặc `null` khi chưa có (stream chưa mở, hay chưa nhận frame nào). */
  const [frame, setFrame] = useState<MetricsFrame | null>(null);
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [refreshingDisk, setRefreshingDisk] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  /** Service nào đang có một hành động bay, và là hành động nào. Khoá theo id. */
  const [busy, setBusy] = useState<Record<string, api.ServiceAction>>({});
  /** Menu của một hàng, và chỗ nó được mở ra. `null` là không có menu nào đang mở. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const { t } = useTranslation();

  /* Mọi lỗi đi qua đây thành một câu người đọc được. `errorMessage` dịch `code` và điền `params`,
     nên `hint` của MixEngine tới người dùng nguyên vẹn thay vì rơi vào một promise không ai bắt —
     một tab đứng im, rỗng, không nói gì là kết cục tệ hơn bất kỳ thông báo nào. */
  const reload = useCallback(async () => {
    try {
      const [next, list, usage] = await Promise.all([
        api.status(),
        api.services(),
        api.diskUsage(false),
      ]);
      setStatus(next);
      setRows(rowsFrom(list.services));
      setWaiting(next.elevation?.pending ?? 0);
      setDisk(usage);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  /** Nút "Làm mới" của bảng disk usage — `refresh: true` đi bộ đĩa lại, khác `reload()` ở trên vốn
   *  đọc bản daemon giữ sẵn (tới một phút) để không biến mỗi lần quay lại tab thành một lần đi bộ. */
  const refreshDisk = useCallback(async () => {
    setRefreshingDisk(true);
    try {
      setDisk(await api.diskUsage(true));
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setRefreshingDisk(false);
    }
  }, [t]);

  /**
   * Mở danh sách thao tác đang chờ quyền quản trị.
   *
   * Một tab mở ra khi hàng đợi đã có sẵn thứ gì đó **không** nhận `elevation_required` — sự kiện đó
   * chỉ bắn lúc hàng đợi đổi. Nên con số ở `daemon.status` là thứ duy nhất nói rằng có gì đó đang
   * chờ, và `elevation.status` là chỗ lấy danh sách để hiện ra.
   */
  const showWaiting = useCallback(async () => {
    try {
      const answer = await api.elevationStatus();
      setCanPrompt(answer.can_prompt);
      setReason(answer.reason);
      setPending(answer.pending);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  /**
   * Một hành động trên một service.
   *
   * Hàng vẫn đổi theo stream trong lúc hành động đang chạy — đó là luật "trạng thái được thông
   * báo". Nhưng khi call trả về, đọc lại: **sự kiện là best-effort và không bao giờ là đường duy
   * nhất biết trạng thái**, nên tin mỗi stream là để lại một bảng đứng im khi một sự kiện rơi.
   * Đọc lại không phải là suy đoán, nó là đọc.
   */
  const act = useCallback(
    async (id: string, action: api.ServiceAction) => {
      setBusy((current) => ({ ...current, [id]: action }));
      try {
        await api.serviceAction(id, action);
      } catch (e) {
        setError(errorMessage(t, e));
      } finally {
        setBusy((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        await reload();
      }
    },
    [reload, t],
  );

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — sự kiện service_state_changed không bao
  // giờ báo tin một service khác được tạo/xoá ở màn Services, và không method-kiểu-runtime nào
  // (cài/gỡ PHP...) sinh sự kiện gì cho bảng này biết cả; quay lại tab vẫn là đường dự phòng.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  /**
   * `/metrics` khoá vòng đời theo `active`, không theo mount/unmount như `/events`.
   *
   * **Mở kết nối này chính là subscribe** — MixEngine lấy mẫu 1 Hz trong lúc còn ai giữ stream, 1
   * lần/phút khi không. `MixEngineTab.tsx` giữ mọi màn đã-xem-qua ở trong DOM thay vì unmount lúc
   * đổi tab, nên nếu khoá theo unmount, rời Dashboard sang màn khác sẽ không đóng được gì — daemon
   * kẹt ở lấy mẫu nhanh vĩnh viễn dù không còn ai nhìn. Effect cleanup chạy cho cả hai trường hợp
   * (`active` chuyển `false`, và unmount thật), nên khoá theo `active` là đủ cho cả hai.
   */
  useEffect(() => {
    if (!active) return;
    let live = true;
    void api.metricsWatch((raw) => {
      if (!live) return;
      const next = parseMetricsFrame(raw);
      if (next !== null) setFrame(next);
    });
    return () => {
      live = false;
      setFrame(null);
      void api.metricsUnwatch();
    };
  }, [active]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      // Một lô rỗng nghĩa là không còn gì chờ — đóng hộp thoại thay vì để nó đứng đó rỗng không.
      // `elevation_required` mang cả số mới nhất: cập nhật `waiting` thẳng từ đây, không đợi một
      // `reload()` khác — nếu không, nút "N thao tác đang chờ" đứng yên với số cũ sau khi Cho phép,
      // vì bản thân sự kiện này chưa từng được xem là một lý do resync.
      const ops = pendingFrom(raw);
      if (ops !== null) {
        setWaiting(ops.length);
        if (ops.length === 0) {
          setPending(null);
        } else if (active) {
          // `elevation_required` chỉ mang `pending` (đúng hình `{"type":"elevation_required",
          // "pending":[…]}`), không mang `can_prompt`/`reason` — đọc lại qua `elevation.status`
          // trước khi tự mở dialog, để biết máy này còn bật prompt được không (vd. một `hosts-apply`
          // cũ kẹt trong hàng đợi từ trước, nhưng helper vừa bị một lệnh Uninstall xoá).
          //
          // **Chỉ khi màn này đang hiện.** `MixEngineTab` giữ Dashboard trong DOM khi người dùng ở
          // màn khác, và `Modal` vẽ qua portal nên một dialog mở từ đây vẫn nổi lên trên màn đó —
          // trong khi màn tự khởi phát thao tác (CaBlock "Fix browser trust", Doctor "Repair") đã
          // mở dialog của riêng nó cho đúng hàng đợi này: hai modal y hệt, cùng một job grant.
          // Khi ẩn, Dashboard chỉ giữ con số cho nút "N đang chờ"; ai mở tab sẽ thấy nút đó.
          void showWaiting();
        }
      }
      setJobs((current) => applyJob(current, raw));
      // Sự kiện là best-effort: khi bus bên kia tràn hay kết nối đứt, đọc lại thay vì tin cái đang
      // có trên màn hình. Ngoài updater, vì updater chạy hai lần trong StrictMode.
      // `job_finished` cũng là một lý do đọc lại: một `elevation.grant` xong đổi số "N đang chờ"
      // mà không có sự kiện nào riêng nói vậy (xem `isJobFinished`).
      if (needsResync(raw) || isJobFinished(raw)) void reload();
      setRows((current) => applyEvent(current, raw).rows);
    });
  }, [active, reload, showWaiting]);



  /**
   * Hàng này có mở được thư mục data của nó không — **hiện tại luôn là không**.
   *
   * Daemon *biết* thư mục đó: `ServiceRemoval.data_kept` nêu tên nó ra. Nhưng nó chỉ nói ở
   * `service.delete`; không method đọc nào trả về đường dẫn, và `ServiceSummary` — thứ cả
   * `service.list` lẫn `service.status` trả về — không có field nào cho nó.
   *
   * Suy ra từ `daemon.status.home` cộng quy ước `data/<package>/<instance>` thì chạy được với mọi
   * service trên máy hôm nay, nhưng `ServiceCreate.data_dir` cho phép đặt chỗ khác — và một nút mở
   * nhầm thư mục thì tệ hơn một nút xám. Nên nút ở đây xám cho tới khi có một method đọc trả về
   * đường dẫn; lúc đó chỉ hàm này đổi, phần menu bên dưới đã sẵn sàng.
   */
  function canOpenDataDir(): boolean {
    return false;
  }


  /** Class màu cho một trạng thái; chuỗi rỗng cho trạng thái không biết, để nó vẽ như chữ thường. */
  function toneClass(state: string | null | undefined): string {
    const tone = serviceStateTone(state);
    return tone === null ? "" : styles[tone];
  }

  /** Trạng thái đã dịch; một trạng thái daemon mới hơn build này hiện nguyên văn. */
  function stateLabel(state: string | null | undefined): string {
    const key = serviceStateKey(state);
    return key === null ? (state ?? "—") : t(key);
  }

  return (
    <div className={styles.dashboard}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {status && (
        <header className={styles.header}>
          <strong>MixEngine {status.version}</strong>
          <span className={styles.home}>{status.home}</span>
          {/* Daemon không có `ServiceRow` — vẽ riêng khỏi bảng service, không chèn vào `rows`.
              `.daemonUsage` đẩy nó sát bên phải header. */}
          {(() => {
            const daemon = readingFor(frame, DAEMON_SUBJECT);
            return (
              daemon && (
                <span className={`${styles.home} ${styles.daemonUsage}`}>
                  {t("mixengine.dashboard.daemonUsage", {
                    cpu: daemon.cpu_percent === null ? "—" : formatPercent(daemon.cpu_percent),
                    rss: formatBytes(daemon.rss_bytes),
                  })}
                </span>
              )
            );
          })()}
        </header>
      )}

      {/* Hàng riêng, xuống dưới header, hai nút sát bên phải — tách khỏi header để header không dài
          thêm mỗi lần một field trạng thái mới được thêm vào. */}
      <div className={styles.headerActions}>
        {/* Không tự bật hộp thoại lúc mở tab: một lô có thể nằm chờ nhiều ngày, và một modal bật
            lên mỗi lần mở tab là thứ người ta học cách bấm bỏ mà không đọc. Một nút nói đúng điều
            cần nói, đặt ở hàng hành động (nơi người ta tìm thứ để bấm) chứ không ở header (dòng
            định danh: version, home, CPU/RSS) — `.headerButtons` đẩy sang phải nên nút này tự đứng
            sát mép trái. */}
        {waiting > 0 && pending === null && (
          <button className={styles.waiting} onClick={() => void showWaiting()}>
            {t("mixengine.dashboard.elevationWaiting", { count: waiting })}
          </button>
        )}
        <div className={styles.headerButtons}>
          {/* Đường dự phòng thủ công cho đúng lỗ hổng comment `reload` ở trên đã nêu: một service
              được tạo/xoá từ nơi khác (CLI, một tab MixDB khác) không sinh sự kiện nào cho bảng này
              biết — quay lại tab là đường dự phòng tự động, nút này là đường dự phòng chủ động. */}
          <button onClick={() => void reload()}>{t("mixengine.dashboard.reload")}</button>
          {/* Không đổi hàng nào ở đây: bảng đổi khi `service_state_changed` tới, không khi bấm. */}
          <button
            onClick={() =>
              void Promise.all(
                rows.filter((row) => row.state === "running").map((row) => act(row.id, "stop")),
              )
            }
            disabled={rows.every((row) => row.state !== "running") || Object.keys(busy).length > 0}
          >
            {t("mixengine.dashboard.stopAll")}
          </button>
          <button onClick={() => setCreating(true)}>{t("mixengine.serviceForm.newService")}</button>
        </div>
      </div>

      {jobs.length > 0 && (
        <ul className={styles.jobs}>
          {jobs.map((job) => (
            <li key={job.id}>
              <span>{job.kind || t("mixengine.dashboard.job")}</span>
              <progress value={job.percent} max={100} />
              <span>{job.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          {/* Bề rộng khai ở đây chứ không để nội dung quyết — xem `table-layout: fixed` bên CSS.
              Tỉ lệ lấy từ bề rộng nội tại đo được của từng cột, không phải ước lượng. */}
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "34%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{t("mixengine.dashboard.service")}</th>
              <th>{t("mixengine.dashboard.state")}</th>
              <th>{t("mixengine.dashboard.port")}</th>
              <th>{t("mixengine.dashboard.cpu")}</th>
              <th>{t("mixengine.dashboard.rss")}</th>
              <th>{t("mixengine.dashboard.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const reading = readingFor(frame, metricsSubjectFor(row.id));
              return (
              <tr key={row.id}>
                {/* Cột cố định không nới ra cho một id dài, nên id đầy đủ ở lại trong `title`. */}
                <td title={row.id}>{row.id}</td>
                <td>
                  {busy[row.id] ? (
                    /* Một hành động vừa gửi đi và chưa có sự kiện nào xác nhận: cũng là "đang
                       chuyển", nên cùng màu với `starting`/`stopping`, chỉ thêm nghiêng. */
                    <span className={`${styles.pending} ${styles.busy}`}>
                      {t(PENDING_LABEL[busy[row.id]])}
                    </span>
                  ) : (
                    <span className={toneClass(row.state)}>{stateLabel(row.state)}</span>
                  )}
                </td>
                <td>{row.port ?? "—"}</td>
                {/* Vắng mặt trong frame (chưa có stream, hay service chưa lọt vào lần đo) là "—",
                    không phải 0% — một service rảnh và một service không đo được là hai câu khác
                    nhau. `cpu_percent: null` trên chính sample cũng vẽ "—" vì cùng lý do đó. */}
                <td>
                  {reading === null || reading.cpu_percent === null
                    ? "—"
                    : formatPercent(reading.cpu_percent)}
                </td>
                <td>{reading === null ? "—" : formatBytes(reading.rss_bytes)}</td>
                <td className={styles.actions}>
                  {/* Nghỉ thì là một cái đèn báo, chạm vào thì là một cái nút. Màu lúc nghỉ nói
                      *trạng thái* (cùng bảng với cột State), màu lúc hover nói *việc sắp làm*.
                      `aria-label` mang việc đó kèm tên service, nên trình đọc màn hình nghe được
                      "Tắt mariadb@main" chứ không nghe một cái nút không tên. */}
                  {(() => {
                    const mode = toggleMode(row.state, busy[row.id] !== undefined);
                    if (mode === "moving") {
                      return (
                        <button
                          className={`${styles.toggle} ${styles.moving}`}
                          aria-label={t("mixengine.dashboard.moving", { service: row.id })}
                          disabled
                        >
                          <span className={styles.dots} aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                        </button>
                      );
                    }
                    const action = mode === "up" ? "stop" : "start";
                    const label = t(`mixengine.dashboard.${action}`);
                    return (
                      <button
                        className={`${styles.toggle} ${styles[mode]} ${toneClass(row.state)}`}
                        aria-label={t(`mixengine.dashboard.${action}Service`, { service: row.id })}
                        onClick={() => void act(row.id, action)}
                      >
                        <span className={styles.dot} aria-hidden="true" />
                        <span className={styles.label}>{label}</span>
                      </button>
                    );
                  })()}
                  <button
                    className={styles.restart}
                    onClick={() => void act(row.id, "restart")}
                    disabled={busy[row.id] !== undefined}
                  >
                    {t("mixengine.dashboard.restart")}
                  </button>
                  <button
                    className={styles.more}
                    aria-label={t("mixengine.dashboard.rowMenu")}
                    title={t("mixengine.dashboard.noDataDir")}
                    disabled={!canOpenDataDir()}
                    onClick={(e) => {
                      const at = e.currentTarget.getBoundingClientRect();
                      setMenu({ id: row.id, x: at.left, y: at.bottom });
                    }}
                  >
                    ⋮
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className={styles.empty}>{t("mixengine.dashboard.noServices")}</p>}

      <DiskUsagePanel
        disk={disk}
        refreshing={refreshingDisk}
        onRefresh={() => void refreshDisk()}
        onCleanup={() => setCleaning(true)}
      />

      {cleaning && disk && (
        <CleanupDialog
          disk={disk}
          onCancel={() => setCleaning(false)}
          onStarted={() => setCleaning(false)}
        />
      )}

      {/* Chỉ dựng khi có hàng nào mở nó ra — mà hiện chưa hàng nào mở được, vì `canOpenDataDir`
          còn trả `false`. Phần khung để sẵn ở đây nên lúc daemon có đường dẫn thì không phải nghĩ
          lại từ đầu. */}
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button type="button" onClick={() => setMenu(null)}>
            {t("mixengine.dashboard.openDataDir")}
          </button>
        </ContextMenu>
      )}

      {creating && (
        <ServiceForm
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}

      {pending && (
        <ElevationDialog
          pending={pending}
          canPrompt={canPrompt}
          reason={reason}
          onClose={() => {
            setPending(null);
            // Sau grant hoặc drop, hàng đợi đã khác: đọc lại con số thay vì giữ cái cũ.
            void reload();
          }}
        />
      )}
    </div>
  );
}

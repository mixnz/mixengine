import { useCallback, useEffect, useRef, useState } from "react";

import ActionBar from "../../../../components/ActionBar";
import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ContextMenu from "../../../../components/ContextMenu";
import ErrorBanner from "../../../../components/ErrorBanner";
import { MoreIcon } from "../../../../icons";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DaemonStatus } from "@mixengine/api";
import type { DatabaseClientReport } from "@mixengine/api";
import type { DatabaseCredentials } from "@mixengine/api";
import type { DiskUsage } from "@mixengine/api";
import CredentialDialog from "../../components/CredentialDialog";
import ElevationDialog from "../../components/ElevationDialog";
import ServiceForm from "../../components/ServiceForm";
import {
  applyEvent,
  applyJob,
  isJobFinished,
  movesARow,
  needsResync,
  rowsFrom,
  type JobRow,
  type ServiceRow,
} from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import type { MetricsFrame } from "@mixengine/api";
import {
  DAEMON_SUBJECT,
  formatBytes,
  formatPercent,
  metricsSubjectFor,
  parseMetricsFrame,
  readingFor,
} from "../../metricsState";
import { pendingFrom } from "../../pendingOps";
import {
  DATABASE_MODULE_ID,
  openChoices,
  opensADatabase,
} from "../ServicesDetail/openChoices";
import { eventArrived, noReadsYet, readBegan, readLanded } from "../../readOrder";
import { serviceStateKey, serviceStateTone, toggleMode } from "../../serviceStateLabel";
import CleanupDialog from "./CleanupDialog";
import DiskUsagePanel from "./DiskUsagePanel";
import QuickStart from "./QuickStart";
import { shouldOfferQuickStart } from "../../quickStart";
import type { SiteSummary } from "@mixengine/api";
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
export default function Dashboard({
  active,
  isModuleVisible,
}: {
  active: boolean;
  /** Whether this window draws the built-in database client — T110. Straight through to the row
   *  menu, which is where *open* lives now. */
  isModuleVisible: (moduleId: string) => boolean;
}) {
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
  /** `site.list`, hay `null` khi chưa đọc xong — điều kiện vẽ thẻ Quick Start (T117). */
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [refreshingDisk, setRefreshingDisk] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  /** Service nào đang có một hành động bay, và là hành động nào. Khoá theo id. */
  const [busy, setBusy] = useState<Record<string, api.ServiceAction>>({});
  /** Menu của một hàng, và chỗ nó được mở ra. `null` là không có menu nào đang mở. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /**
   * `database.client` cho từng service, tra **một lần cho mỗi id** rồi nhớ.
   *
   * **Phải biết trước khi bấm, nên không thể tra lúc mở menu.** Nút ⋮ của một service không phải
   * database phải xám ngay từ lúc vẽ — mở ra một menu rỗng rồi mới biết là tệ hơn không mời bấm.
   *
   * Tra một lượt cho mỗi id là chấp nhận được vì **câu trả lời không bao giờ đổi**: nó là protocol
   * của recipe, tức một thuộc tính của package service này chạy ra. Nên lần đọc `service.list` đầu
   * tiên trả giá N lượt, và mọi lần `reload()` sau đó — mỗi lần quay lại tab, mỗi `resync` — trả
   * giá 0.
   *
   * Vắng mặt một id nghĩa là chưa hỏi xong *hoặc* đã hỏi hỏng, và cả hai đều vẽ ra một nút xám.
   */
  const [databases, setDatabases] = useState<Record<string, DatabaseClientReport>>({});
  /** Những id đã gửi câu hỏi đi, để `rows` đổi theo stream không biến thành một tràng RPC. */
  const asked = useRef(new Set<string>());
  /** Mật khẩu đang hiện trong hộp thoại, hoặc `null`. Không bao giờ nằm trong `rows`. */
  const [credentials, setCredentials] = useState<DatabaseCredentials | null>(null);
  /** Service đang được hỏi "đặt lại mật khẩu?", hoặc `null`. */
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const { t } = useTranslation();

  /**
   * Thứ tự giữa các lần đọc và các sự kiện — xem `readOrder.ts`.
   *
   * **`rows` có hai người ghi và không cái nào biết cái kia.** Một snapshot `service.list` và một
   * `service_state_changed` cùng gọi `setRows`, và React ghi theo thứ tự **tới**, không theo thứ
   * tự *đúng*. Bấm Stop all là lúc điều đó lộ ra: nhiều thao tác xong gần nhau, nhiều lượt đọc và
   * nhiều sự kiện chen nhau trên đường về, nên một snapshot cũ ghi đè một snapshot mới — và vì
   * `stopped` là chuyển trạng thái cuối cùng, không còn sự kiện nào sửa lại. Hàng đứng ở "Đang
   * tắt" cho tới khi có người bấm Làm mới.
   *
   * `useRef` chứ không phải `useState`: đây là sổ ghi thứ tự, không phải thứ được vẽ, và một
   * `setState` ở đây sẽ render lại mỗi lần một message đi qua.
   */
  const order = useRef(noReadsYet());

  /* Mọi lỗi đi qua đây thành một câu người đọc được. `errorMessage` dịch `code` và điền `params`,
     nên `hint` của MixEngine tới người dùng nguyên vẹn thay vì rơi vào một promise không ai bắt —
     một tab đứng im, rỗng, không nói gì là kết cục tệ hơn bất kỳ thông báo nào. */
  const reload = useCallback(async () => {
    /* Vòng lặp chứ không đệ quy: một `useCallback` không gọi được chính nó. Nó quay thêm một vòng
       đúng khi có sự kiện chen vào giữa lượt đọc vừa rồi, và dừng ngay lượt đầu tiên không bị
       chen — mỗi vòng là một round trip thật, nên nó tự giới hạn nhịp. */
    for (;;) {
      const began = readBegan(order.current);
      order.current = began.order;
      let landed;
      try {
        const [next, list, usage] = await Promise.all([
          api.status(),
          api.services(),
          api.diskUsage(false),
        ]);
        landed = readLanded(order.current, began.seq);
        order.current = landed.order;
        // Một snapshot khởi hành trước một snapshot đã vẽ rồi thì không được vẽ: nó mang tin cũ
        // hơn thứ đang trên màn hình, dù nó về sau.
        if (landed.apply) {
          setStatus(next);
          setRows(rowsFrom(list.services));
          setWaiting(next.elevation?.pending ?? 0);
          setDisk(usage);
        }
        setError("");
      } catch (e) {
        // Một lượt đọc hỏng vẫn phải hạ cánh, nếu không `inFlight` không bao giờ về 0 và mọi sự
        // kiện sau đó đều bị coi là đang đua.
        landed = readLanded(order.current, began.seq);
        order.current = landed.order;
        setError(errorMessage(t, e));
      }
      if (!landed.readAgain) return;
    }
  }, [t]);

  /**
   * Home này đã có site nào chưa — điều kiện vẽ thẻ Quick Start (T117).
   *
   * Đọc riêng khỏi `reload()` chứ không gộp vào `Promise.all` của nó: `reload()` chạy lại mỗi lần
   * quay lại tab và mỗi lần stream nói có gì đổi, còn câu hỏi này chỉ đổi khi một site được tạo
   * hoặc xoá. Thất bại thì để nguyên giá trị cũ và không dựng banner lỗi: một Dashboard đỏ vì
   * không hỏi được "đã có site chưa" là một Dashboard đỏ vì một câu trang trí.
   */
  const readSites = useCallback(async () => {
    try {
      const listed = await api.sites();
      setSites(listed.sites);
    } catch {
      // Để nguyên: `null` vẫn là "chưa biết", và `shouldOfferQuickStart` không mời trên `null`.
    }
  }, []);

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
   * Gửi một hành động và chờ nó xong. **Không đọc lại** — ai gọi mới quyết định lúc nào đọc.
   *
   * Hàng vẫn đổi theo stream suốt lúc đó, đúng luật "trạng thái được thông báo". Việc đọc lại tách
   * ra khỏi đây vì một lần bấm Stop all là *một* câu hỏi chứ không phải N: xem [`stopAll`].
   */
  const run = useCallback(
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
      }
    },
    [t],
  );

  /**
   * Một hành động trên một hàng, rồi đọc lại.
   *
   * **Sự kiện là best-effort và không bao giờ là đường duy nhất biết trạng thái**, nên tin mỗi
   * stream là để lại một bảng đứng im khi một sự kiện rơi. Đọc lại không phải là suy đoán, nó là
   * đọc — và `order` ở trên là thứ giữ cho lần đọc ấy không bị một lần đọc cũ hơn ghi đè.
   */
  const act = useCallback(
    async (id: string, action: api.ServiceAction) => {
      await run(id, action);
      await reload();
    },
    [reload, run],
  );

  /**
   * Tắt mọi thứ đang chạy, rồi đọc lại **một** lần.
   *
   * Không phải `Promise.all` của `act`: cách đó bắn N lượt `reload` song song cho một lần bấm, mỗi
   * lượt ba RPC, và chúng đua nhau — đúng thứ `order` ở trên tồn tại để chặn. Chặn được không có
   * nghĩa là nên gây ra: một lần bấm là một câu hỏi, nên hỏi một lần.
   */
  const stopAll = useCallback(async () => {
    await Promise.all(
      rows.filter((row) => row.state === "running").map((row) => run(row.id, "stop")),
    );
    await reload();
  }, [reload, rows, run]);

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — sự kiện service_state_changed không bao
  // giờ báo tin một service khác được tạo/xoá ở màn Services, và không method-kiểu-runtime nào
  // (cài/gỡ PHP...) sinh sự kiện gì cho bảng này biết cả; quay lại tab vẫn là đường dự phòng.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  // Cùng nhịp, riêng call: xem `readSites`.
  useEffect(() => {
    if (active) void readSites();
  }, [active, readSites]);

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
      // Một sự kiện đổi hàng, tới trong lúc một `service.list` đang trên đường về, nghĩa là
      // snapshot đó có thể đã đọc *trước* sự kiện này — client không phân biệt được. Ghi lại ở đây
      // để lượt đọc ấy xin thêm một lượt nữa khi hạ cánh. Ngoài updater, cùng lý do hai dòng trên.
      if (movesARow(raw)) order.current = eventArrived(order.current);
      setRows((current) => applyEvent(current, raw).rows);
    });
  }, [active, reload, showWaiting]);



  /**
   * Hỏi `database.client` cho những id chưa từng hỏi.
   *
   * **`ServiceSummary` không trả lời được câu này.** `ServiceRole` chỉ phân biệt front end với
   * phần còn lại, và [ADR 0026] cấm client suy ra vai trò từ tên package — nên `database.client`
   * là đường duy nhất. Chạy theo `rows` vì đó là nơi một service mới xuất hiện.
   *
   * Một câu hỏi hỏng thì **bỏ id ra khỏi `asked`**: lần `reload()` sau hỏi lại. Giữ nó lại là để
   * một trục trặc thoáng qua khoá nút ⋮ của hàng đó cho tới khi đóng cửa sổ.
   *
   * [ADR 0026]: https://github.com/mixnz/mixengine/blob/master/.claude/decisions/0026-the-active-front-end-is-a-row-and-switching-it-is-a-job.md
   */
  useEffect(() => {
    const missing = rows.map((row) => row.id).filter((id) => !asked.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) asked.current.add(id);

    void (async () => {
      const answers = await Promise.all(
        missing.map(async (id) => {
          try {
            return [id, await api.databaseClient(id)] as const;
          } catch {
            asked.current.delete(id);
            return [id, null] as const;
          }
        }),
      );
      setDatabases((current) => {
        const next = { ...current };
        for (const [id, report] of answers) if (report !== null) next[id] = report;
        return next;
      });
    })();
  }, [rows]);

  /** Lấy mật khẩu quản trị viên của một service và mở hộp thoại. */
  const showCredentials = useCallback(
    async (id: string) => {
      try {
        setCredentials(await api.databaseCredentials(id));
      } catch (e) {
        setError(errorMessage(t, e));
      }
    },
    [t],
  );

  /** Chạy `service.reset_credential`, rồi đọc lại — nó dừng và bật lại nhiều service. */
  const resetCredential = useCallback(
    async (id: string) => {
      try {
        await api.serviceResetCredential(id);
      } catch (e) {
        setError(errorMessage(t, e));
      } finally {
        await reload();
      }
    },
    [reload, t],
  );


  /**
   * Bật hay tắt autostart cho một service — cùng cột mà `AutostartPanel` ở màn Services đổi.
   *
   * **Ghi lại thứ daemon trả về, không phải thứ vừa bấm.** Một hàng nói "có" trong khi cột trong
   * database vẫn là "không" tệ hơn một hàng đổi chậm — cùng luật cả bảng này đang theo.
   *
   * Không khởi động và không dừng gì cả, nên không đi qua `busy`: thứ nó đổi là walk ở lần daemon
   * khởi động sau (T112/T113).
   */
  const setAutostart = useCallback(
    async (id: string, autostart: boolean) => {
      try {
        const summary = await api.serviceSetAutostart({ service: id, autostart });
        setRows((current) =>
          current.map((row) => (row.id === id ? { ...row, autostart: summary.autostart } : row)),
        );
      } catch (e) {
        setError(errorMessage(t, e));
      }
    },
    [t],
  );

  /** Hàng đang mở menu. Menu chỉ sống cùng một `menu.id`, nhưng bảng thì cập nhật từ stream, nên
   *  đọc lại từ `rows` thay vì chụp ảnh hàng lúc mở — nhãn autostart phải theo cột bên cạnh. */
  const menuRow = menu === null ? undefined : rows.find((row) => row.id === menu.id);

  /** Câu trả lời cho hàng đang mở menu, buộc vào một tên: `databases[menu.id]` đọc hai lần thì
   *  TypeScript mất luôn phần thu hẹp kiểu trên `client`.
   *
   *  `opensADatabase` lọc ngay ở đây chứ không còn ở nút ⋮: `database.client` cũng trả lời cho
   *  nginx và cho một php-fpm pool, chỉ là với `protocol: null`, nên có mặt trong `databases`
   *  không có nghĩa là có gì để mở. */
  const menuReport =
    menuRow === undefined ? undefined : databases[menuRow.id];
  const menuDatabase =
    menuReport !== undefined && opensADatabase(menuReport) ? menuReport : undefined;

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

      {/* Trên bảng service, và chỉ khi home này chưa có site nào — T117. Điều kiện là trạng thái
          của home chứ không phải một cờ "đã bỏ qua": không có gì để lưu, migrate hay sửa tay sai,
          và một máy vừa xoá hết site thì thấy lời mời quay lại, đúng như nó nên. */}
      {shouldOfferQuickStart(sites) && <QuickStart onCreated={() => void readSites()} />}

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
          <Button className={styles.waiting} onClick={() => void showWaiting()}>
            {t("mixengine.dashboard.elevationWaiting", { count: waiting })}
          </Button>
        )}
        <div className={styles.headerButtons}>
          {/* Đường dự phòng thủ công cho đúng lỗ hổng comment `reload` ở trên đã nêu: một service
              được tạo/xoá từ nơi khác (CLI, một tab MixDB khác) không sinh sự kiện nào cho bảng này
              biết — quay lại tab là đường dự phòng tự động, nút này là đường dự phòng chủ động. */}
          <Button onClick={() => void reload()}>{t("mixengine.dashboard.reload")}</Button>
          {/* Không đổi hàng nào ở đây: bảng đổi khi `service_state_changed` tới, không khi bấm. */}
          <Button
            onClick={() => void stopAll()}
            disabled={rows.every((row) => row.state !== "running") || Object.keys(busy).length > 0}
          >
            {t("mixengine.dashboard.stopAll")}
          </Button>
          <Button onClick={() => setCreating(true)}>{t("mixengine.serviceForm.newService")}</Button>
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
              Tỉ lệ lấy từ bề rộng nội tại đo được của từng cột, không phải ước lượng.

              Measured against the *longest translation of each header*, not against English. At the
              table's own `min-width` (57rem, and `1rem` is 14px here) Autostart's old 9% came to
              72px, 12px of which is the cell's padding — enough for "Autostart" (57px) and not for
              "Tự khởi động" (82px), so the Vietnamese header sat there clipped to an ellipsis. The
              three points it needed came off Service (an id already carries `title` and is the one
              cell meant to elide) and off CPU and RSS, whose widest readings are "100.0%" and
              "128.4 MB". */}
          <colgroup>
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "31%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{t("mixengine.dashboard.service")}</th>
              <th>{t("mixengine.dashboard.state")}</th>
              {/* Cạnh State và không ở cuối bảng — T114. Hai cột này là câu người đang quét bảng
                  thật sự hỏi: cái gì đang chạy, và cái gì sẽ chạy sau lần đăng nhập tới. */}
              <th>{t("mixengine.dashboard.autostart")}</th>
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
                <td>
                  {t(
                    row.autostart
                      ? "mixengine.dashboard.autostartYes"
                      : "mixengine.dashboard.autostartNo",
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
                  {/* `small` cùng lý do `.toggle` cao 26px: đây là ô hành động của một hàng bảng,
                      và cỡ dày đặc là cỡ ba control ở đây dùng chung. */}
                  <Button
                    size="small"
                    className={styles.restart}
                    onClick={() => void act(row.id, "restart")}
                    disabled={busy[row.id] !== undefined}
                  >
                    {t("mixengine.dashboard.restart")}
                  </Button>
                  {/* `ActionBar` chứ không phải một `<button>` tự vẽ: nó *là* primitive cho nút
                      chỉ-có-icon, và nó mang sẵn đúng luật chỗ này cần.

                      Không bao giờ xám nữa: autostart là một cột của *mọi* service, nên nginx và
                      một php-fpm pool cũng có một mục để bấm — trước đây menu chỉ toàn mục của một
                      database, và với những hàng ấy mở ra là mở ra một cái rỗng. */}
                  <ActionBar
                    actions={[
                      {
                        key: "menu",
                        icon: MoreIcon,
                        label: t("mixengine.dashboard.rowMenu"),
                        onClick: (event) => {
                          const at = event.currentTarget.getBoundingClientRect();
                          setMenu({ id: row.id, x: at.left, y: at.bottom });
                        },
                      },
                    ]}
                  />
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

      {/* Menu này không bao giờ rỗng, và đó là lý do nút ⋮ không còn xám: autostart có mặt cho
          *mọi* service, kể cả khi `openChoices` trả về danh sách rỗng vì máy không có client nào
          và kể cả khi hàng ấy không phải một database.

          **"Mở thư mục dữ liệu" vẫn không có mặt** chứ không để xám: daemon biết thư mục ấy —
          `ServiceRemoval.data_kept` gọi tên nó — nhưng chỉ nói ở `service.delete`, và không method
          đọc nào trả về đường dẫn (`ServiceCreate.data_dir` là *đầu vào*). Cửa sổ thì mở được thư
          mục, `tauri-plugin-opener` đã có sẵn; thứ thiếu là đường dẫn, không phải cách mở. Một mục
          xám vĩnh viễn là một lời hứa không ai định giữ. */}
      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {/* Nhãn lật theo cột Autostart của chính hàng đó, chứ không phải một dấu tick: mục menu ở
              đây là `<button>` mang `role="menuitem"`, và một dấu tick không có `menuitemcheckbox`
              đứng sau là một trạng thái chỉ nhìn mới thấy. */}
          {menuRow !== undefined && (
            <button
              type="button"
              onClick={() => {
                const id = menuRow.id;
                const wanted = !menuRow.autostart;
                setMenu(null);
                void setAutostart(id, wanted);
              }}
            >
              {t(
                menuRow.autostart
                  ? "mixengine.dashboard.autostartOff"
                  : "mixengine.dashboard.autostartOn",
              )}
            </button>
          )}

          {menuDatabase !== undefined && (
            <>
              {openChoices(menuDatabase.client, isModuleVisible(DATABASE_MODULE_ID)).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => {
                    const id = menu.id;
                    setMenu(null);
                    /* `external` rời khỏi tiến trình này qua `database.open`; hai cái kia mở một
                       tab `db` ngay trong cửa sổ. Mật khẩu không đi qua đường nào trong hai:
                       daemon đọc nó và đặt vào môi trường của thứ nó khởi động (T83). */
                    void (choice === "external"
                      ? api.databaseOpen(id)
                      : api.databaseOpenInMixDB(id)
                    ).catch((e: unknown) => setError(errorMessage(t, e)));
                  }}
                >
                  {choice === "external"
                    ? t("mixengine.dashboard.openDatabaseExternal", {
                        name: menuDatabase.client.state === "installed" ? menuDatabase.client.name : "",
                      })
                    : t(
                        choice === "builtIn"
                          ? "mixengine.dashboard.exploreData"
                          : "mixengine.dashboard.exploreDataEnabling",
                      )}
                </button>
              ))}

              <button
                type="button"
                onClick={() => {
                  const id = menu.id;
                  setMenu(null);
                  void showCredentials(id);
                }}
              >
                {t("mixengine.dashboard.credentials")}
              </button>

              {/* Dấu ba chấm là lời hứa: bấm vào mở một câu hỏi, không chạy ngay một thao tác dừng
                  service này và mọi thứ phụ thuộc nó. */}
              <button
                type="button"
                onClick={() => {
                  const id = menu.id;
                  setMenu(null);
                  setResetTarget(id);
                }}
              >
                {t("mixengine.dashboard.resetCredential")}
              </button>
            </>
          )}
        </ContextMenu>
      )}

      {credentials !== null && (
        <CredentialDialog credentials={credentials} onClose={() => setCredentials(null)} />
      )}

      {/* Không `danger`: `ConfirmDialog` dành màu đó cho thao tác **mất dữ liệu**, và đây giữ
          nguyên mọi database — đúng câu quyết định chuyện này cho người đọc, nên nó nằm trong
          `message` chứ không phải trong một dòng nhỏ ở đâu đó. */}
      {resetTarget !== null && (
        <ConfirmDialog
          title={t("mixengine.dashboard.resetTitle")}
          message={t("mixengine.dashboard.resetMessage", { service: resetTarget })}
          confirmLabel={t("mixengine.dashboard.resetConfirm")}
          onConfirm={() => {
            const id = resetTarget;
            setResetTarget(null);
            void resetCredential(id);
          }}
          onCancel={() => setResetTarget(null)}
        />
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

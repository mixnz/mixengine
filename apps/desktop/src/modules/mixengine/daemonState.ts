import type { ServiceState, StoppedBy } from "@mixengine/api";
import type { ServiceSummary } from "@mixengine/api";

/**
 * Rút gọn stream sự kiện thành state của bảng.
 *
 * Thuần và không gọi gì — đó là lý do nó ở đây chứ không nằm trong component. Luật **"trạng thái
 * được thông báo, không bao giờ được suy ra"** là thứ đáng có test, và một `useEffect` thì không
 * test được.
 */

/** Một dòng của bảng service. Chỉ những gì bảng vẽ. */
export interface ServiceRow {
  id: string;
  state: ServiceState | null;
  port: number | null;
  /** Có khởi động cùng daemon không — T112. Chỉ là **cài đặt**, không phải dự đoán: nó nói cột
   *  trong database, không nói service này sẽ chạy sau lần đăng nhập tới (còn tuỳ cổng có rảnh và
   *  chương trình còn đó không). Sự kiện `service_state_changed` không đổi nó, nên `applyEvent`
   *  giữ nguyên giá trị cũ và chỉ một lần đọc lại `service.list` mới đổi được. */
  autostart: boolean;
  /** Ai để nó dừng, khi nó đang dừng — T167g. `daemon` nghĩa là MixEngine tự dừng (vì rảnh), và
   *  request kế tiếp sẽ bật lại; `null` khi đang chạy hoặc daemon cũ không gửi. */
  stoppedBy: StoppedBy | null;
  /** Phiên bản chương trình service đang chạy — T183. `null` khi daemon không gửi (daemon cũ,
   *  service của extension…), và khi đó không vẽ gì cả. */
  version: string | null;
}

/** Một câu trả lời `service.list`, thành các dòng. */
export function rowsFrom(list: ServiceSummary[]): ServiceRow[] {
  return list.map((service) => ({
    id: service.id,
    state: service.state ?? null,
    port: service.port ?? null,
    autostart: service.autostart,
    stoppedBy: service.stopped_by ?? null,
    version: service.version ?? null,
  }));
}

/**
 * Message này có nghĩa là "đừng tin cái đang có, đọc lại" không.
 *
 * Tách khỏi [`applyEvent`] vì câu trả lời chỉ phụ thuộc vào message, không phụ thuộc vào bảng — và
 * vì gọi nó **ngoài** updater của `setState` là chỗ duy nhất đúng: React gọi updater hai lần trong
 * StrictMode, nên một tác dụng phụ đặt trong đó sẽ chạy hai lần cho mỗi sự kiện.
 */
export function needsResync(raw: string): boolean {
  try {
    const { type } = JSON.parse(raw) as { type?: unknown };
    return type === "resync" || type === "mixdb_disconnected";
  } catch {
    return false;
  }
}

/** Có phải một `job_finished` không — bất kể job nào. Dashboard đọc lại `daemon.status` khi thấy
 *  nó, vì một `elevation.grant` xong (từ dialog, từ CLI, hay từ một cửa sổ MixDB khác) đổi số
 *  thao tác đang chờ mà daemon không phát sự kiện nào riêng cho chuyện đó (`elevation_required`
 *  chỉ bắn khi hàng đợi *dài thêm*). */
/** The event stream ended — the daemon stopped, or was stopped from somewhere else (T168: the tray). */
export function isDisconnected(raw: string): boolean {
  try {
    const { type } = JSON.parse(raw) as { type?: unknown };
    return type === "mixdb_disconnected";
  } catch {
    return false;
  }
}

export function isJobFinished(raw: string): boolean {
  try {
    const { type } = JSON.parse(raw) as { type?: unknown };
    return type === "job_finished";
  } catch {
    return false;
  }
}

/**
 * Message này có đổi một hàng của bảng service không.
 *
 * Tách khỏi [`applyEvent`] vì câu trả lời chỉ phụ thuộc vào message — và vì chỗ duy nhất hỏi được
 * là **ngoài** updater của `setRows`, cùng lý do [`needsResync`] nêu: React gọi updater hai lần
 * trong StrictMode.
 *
 * `Dashboard` hỏi câu này để biết một message có đua với một `service.list` đang trên đường về hay
 * không — xem `readOrder.ts`. Chỉ `service_state_changed` được tính: tiến độ job bắn liên tục suốt
 * một lần cài runtime, và coi nó là một lý do đọc lại là biến một job dài thành một tràng RPC.
 */
export function movesARow(raw: string): boolean {
  try {
    const { type } = JSON.parse(raw) as { type?: unknown };
    return type === "service_state_changed";
  } catch {
    return false;
  }
}

/**
 * Bảng sau một message.
 *
 * `resync` là `true` khi thứ vừa tới có nghĩa là "đừng tin cái đang có, đọc lại": bus bên kia tràn,
 * hoặc kết nối đứt. Sự kiện là best-effort và **không bao giờ là đường duy nhất biết trạng thái**.
 */
export function applyEvent(
  rows: ServiceRow[],
  raw: string,
): { rows: ServiceRow[]; resync: boolean } {
  let event: { type?: unknown; service?: unknown; to?: unknown; reason?: unknown };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return { rows, resync: false };
  }

  switch (event.type) {
    case "resync":
    case "mixdb_disconnected":
      return { rows, resync: true };

    case "service_state_changed": {
      /* `service`, **không phải** `id`. Bản phác Rust trong `daemon-and-ipc.md` của MixEngine viết
         `ServiceStateChanged { id, .. }`, nhưng thứ daemon thật sự gửi là `ServiceTransition`, và
         nó gọi field đó là `service`. Đọc nhầm tên thì mọi sự kiện rơi vào im lặng và bảng không
         bao giờ đổi — hợp đồng đã sinh ở `bindings/` (alias `@mixengine/api`) là sự thật, tài liệu kiến trúc thì không. */
      const id = typeof event.service === "string" ? event.service : null;
      const to = typeof event.to === "string" ? (event.to as ServiceState) : null;
      if (id === null || to === null) return { rows, resync: false };
      // Không dựng hàng cho một service chưa biết: `service.list` là chỗ một hàng ra đời, và nó
      // biết những thứ sự kiện này không mang theo.
      const stoppedBy = to === "stopped" ? stoppedByReason(event.reason) : null;
      return {
        rows: rows.map((row) => (row.id === id ? { ...row, state: to, stoppedBy } : row)),
        resync: false,
      };
    }

    default:
      // Một biến thể của phiên bản sau. Bỏ qua là đúng hợp đồng, không phải bỏ sót: sự kiện được
      // internally tagged chính là để chuyện này xảy ra được.
      return { rows, resync: false };
  }
}

/**
 * Ai dừng một service, đọc từ `reason` của sự kiện chuyển sang `stopped` — cùng luật với
 * `StoppedBy::of` bên MixEngine: `requested` và `credential_reset` là một người, mọi lý do khác là
 * máy. Một `reason` không đọc được thì không đoán: `null`, và hàng hiện như trước T167.
 */
export function stoppedByReason(reason: unknown): StoppedBy | null {
  if (typeof reason !== "object" || reason === null) return null;
  const kind = (reason as { kind?: unknown }).kind;
  if (typeof kind !== "string") return null;
  return kind === "requested" || kind === "credential_reset" ? "person" : "daemon";
}

/** Một thao tác dài đang chạy. `id` là rowid của hàng `jobs` bên MixEngine. */
export interface JobRow {
  id: number;
  kind: string;
  percent: number;
  message: string;
}

/**
 * Job đang chạy, sau một message.
 *
 * `job_progress` và `job_finished` mang giá trị **đã được ghi xuống**, không phải một mô tả thứ hai
 * về nó — nên một job kết thúc mà không sống sót qua transaction của nó thì không bao giờ được báo.
 * Tiến độ là thứ duy nhất trên stream được phép lặp lại.
 */
export function applyJob(jobs: JobRow[], raw: string): JobRow[] {
  let event: {
    type?: unknown;
    job?: unknown;
    kind?: unknown;
    percent?: unknown;
    message?: unknown;
  };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return jobs;
  }

  const id = typeof event.job === "number" ? event.job : null;
  if (id === null) return jobs;

  if (event.type === "job_finished") return jobs.filter((job) => job.id !== id);
  if (event.type !== "job_progress") return jobs;

  const row: JobRow = {
    id,
    kind: typeof event.kind === "string" ? event.kind : "",
    percent: typeof event.percent === "number" ? event.percent : 0,
    message: typeof event.message === "string" ? event.message : "",
  };
  const at = jobs.findIndex((job) => job.id === id);
  if (at === -1) return [...jobs, row];
  // `kind` chỉ có ở message đầu; đừng để một message sau xoá nó.
  return jobs.map((job, i) => (i === at ? { ...row, kind: row.kind || job.kind } : job));
}

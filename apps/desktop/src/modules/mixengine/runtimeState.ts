import type { AppError } from "../../core/errors";
import type { PoolOutcome } from "./api/types/PoolOutcome";
import type { JobRow } from "./daemonState";

/** `"php@8.3.12"` — cùng một chuỗi làm key React lẫn key tra `installingJob`. */
export type VersionKey = string;

export function versionKey(kind: string, version: string): VersionKey {
  return `${kind}@${version}`;
}

/** Cách vẽ một `ExtensionChange.pool` — ba giá trị, ba banner khác nhau, không giá trị nào là lỗi. */
export type PoolBanner = "none" | "restartRequired" | "appliesNextStart";

export function poolBanner(outcome: PoolOutcome): PoolBanner {
  switch (outcome) {
    case "reloaded":
      return "none";
    case "restart_required":
      return "restartRequired";
    case "pool_not_running":
      return "appliesNextStart";
  }
}

/** Job đang theo dõi cho một hàng, từ `JobRow[]` `daemonState.applyJob` đã tính — không tự giữ map
 *  job thứ hai, chỉ tra lại cái đã có. */
export function jobFor(jobs: JobRow[], jobId: number | undefined): JobRow | undefined {
  return jobId === undefined ? undefined : jobs.find((job) => job.id === jobId);
}

/** Một job vừa kết thúc: job nào, và nó hỏng vì gì. */
export interface JobFinished {
  id: number;
  /** `null` khi job xong xuôi hoặc bị huỷ theo yêu cầu — chỉ `ending: "failed"` mới có gì để kể. */
  error: AppError | null;
}

/**
 * `job_finished` này nói gì, nếu message này là một `job_finished` — ngược lại `null`.
 *
 * `applyJob` đã xoá job đó khỏi `JobRow[]`, nhưng chỉ xoá thôi không kéo một bản vừa cài xong ra
 * khỏi bảng "có thể cài" — cái đó cần đọc lại `installed`/`available` từ daemon. Tách riêng khỏi
 * `applyJob` vì đây là quyết định "có nên gọi lại API không", không phải state của bảng job.
 *
 * **`ending` là nửa còn lại của câu, không phải chi tiết phụ.** Một job hỏng cũng gửi
 * `job_finished`, và `error` của nó là chỗ *duy nhất* nói ra vì sao: `runtime.install` đã trả lời
 * "đã nhận" từ lâu rồi, nên không còn lời gọi nào thất bại để mà bắt. Đọc mỗi `job` rồi đọc lại
 * danh sách là để người dùng nhìn thanh tiến độ biến mất, danh sách không đổi, và tự đoán.
 */
export function jobFinished(raw: string): JobFinished | null {
  let event: { type?: unknown; job?: unknown; ending?: unknown; error?: unknown };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    // Không phải JSON hợp lệ — không phải việc của hàm này báo lỗi đó.
    return null;
  }
  if (event.type !== "job_finished" || typeof event.job !== "number") return null;
  return {
    id: event.job,
    error: event.ending === "failed" ? refusal(event.error) : null,
  };
}

/**
 * `Error` của daemon, thành thứ `errorMessage` vẽ được.
 *
 * Cùng `code` và cùng tham số mà `map_rpc_error` (`mixengine/rpc.rs`) dựng cho một call bị từ
 * chối, cố ý: **một job hỏng không phải một bộ từ vựng lỗi thứ hai**. Cùng một câu daemon viết,
 * dù nó tới qua answer của call hay qua stream sự kiện, phải hiện ra cùng một cách.
 */
function refusal(value: unknown): AppError {
  const wire = (typeof value === "object" && value !== null ? value : {}) as {
    code?: unknown;
    message?: unknown;
    hint?: unknown;
  };
  const params: Record<string, string> = {
    code: typeof wire.code === "string" ? wire.code : "internal",
    message: typeof wire.message === "string" ? wire.message : "",
  };
  // Vắng mặt chứ không rỗng, cùng luật `map_rpc_error` đã đặt.
  if (typeof wire.hint === "string") params.hint = wire.hint;
  return { code: "error.mixengineRefused", params };
}

/** `RuntimeSummary.installed_at`/`PackageSummary.installed_at` là mili giây epoch (`Timestamp`),
 *  không phải chuỗi — cùng cách `UpdateSection.tsx` đã vẽ `checked_at`: giờ theo múi giờ và định
 *  dạng của chính máy người dùng, không phải một chuẩn cố định. */
export function formatInstalledAt(ms: number): string {
  return new Date(ms).toLocaleString();
}

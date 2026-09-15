import type { AppError } from "../../core/errors";
import type { PoolOutcome } from "@mixengine/api";
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

/**
 * Các bản đã cài của một kind, **mới nhất trước** — thứ một ô pin gợi ý.
 *
 * Sắp lại chứ không tin thứ tự daemon trả về: `runtime.list_installed` đọc `ORDER BY kind,
 * version`, tức là sắp *chuỗi*, nên `8.10.0` về trước `8.9.0`. Một danh sách gợi ý nói sai bản nào
 * mới hơn thì tệ hơn là không sắp gì.
 *
 * So từng đoạn: phần số dẫn đầu so như số, phần đuôi còn lại so như chuỗi và **đuôi ngắn hơn là
 * bản ra sau** — `8.5.0` sau `8.5.0RC1`, đúng luật "một constraint không nhắc pre-release thì không
 * bao giờ chọn pre-release" của `VersionConstraint`. Đây là thứ tự để *hiển thị*; việc chọn bản nào
 * thật sự khớp constraint vẫn là của daemon.
 */
export function installedVersions(
  runtimes: readonly { kind: string; version: string }[],
  kind: string,
): string[] {
  return runtimes
    .filter((runtime) => runtime.kind === kind)
    .map((runtime) => runtime.version)
    .sort((left, right) => compareVersions(right, left));
}

/** Âm khi `left` ra trước `right`. */
function compareVersions(left: string, right: string): number {
  const ours = left.split(".");
  const theirs = right.split(".");
  for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
    // Đoạn thiếu là bản ngắn hơn — `20.11` trước `20.11.1`.
    if (ours[i] === undefined) return -1;
    if (theirs[i] === undefined) return 1;
    const decided = compareSegments(ours[i], theirs[i]);
    if (decided !== 0) return decided;
  }
  return 0;
}

function compareSegments(left: string, right: string): number {
  const ourNumber = Number.parseInt(left, 10);
  const theirNumber = Number.parseInt(right, 10);
  if (ourNumber !== theirNumber) {
    // Một đoạn không mở đầu bằng số cho `NaN`; so như chuỗi là thứ duy nhất còn nghĩa lúc đó.
    if (Number.isNaN(ourNumber) || Number.isNaN(theirNumber)) return left < right ? -1 : 1;
    return ourNumber - theirNumber;
  }

  // Cùng số dẫn đầu: đuôi rỗng (`0`) là bản phát hành, đuôi có chữ (`0RC1`) là bản trước nó.
  const ourTail = left.slice(String(ourNumber).length);
  const theirTail = right.slice(String(theirNumber).length);
  if (ourTail === theirTail) return 0;
  if (ourTail === "") return 1;
  if (theirTail === "") return -1;
  return ourTail < theirTail ? -1 : 1;
}

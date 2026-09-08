import type { AutostartReport } from "./api/types/AutostartReport";
import type { DoctorReport } from "./api/types/DoctorReport";

/**
 * Bốn trạng thái một công tắc tự khởi động có thể ở, không phải hai — T85b.
 *
 * **`enabledOtherHome` là trạng thái cả roadmap lẫn `client-surface.md` đều gọi đích danh**: một
 * entry đã đăng ký thuộc home khác vẫn khiến `enabled: true`, và vẽ nó như `enabledThisHome` là nói
 * "đã bật" cho một công tắc chưa từng chạm tới home đang mở.
 */
export type AutostartPresentation = "unsupported" | "enabledOtherHome" | "enabledThisHome" | "disabled";

export function autostartPresentation(
  report: Pick<AutostartReport, "mechanism" | "enabled" | "for_this_home">,
): AutostartPresentation {
  if (report.mechanism === "none") return "unsupported";
  if (!report.enabled) return "disabled";
  return report.for_this_home ? "enabledThisHome" : "enabledOtherHome";
}

/**
 * Giữ nguyên thứ tự và độ dài `DoctorReport.checks` — không lọc bớt check nào, kể cả mọi
 * `outcome: "ok"`. Hàm này tồn tại chỉ để có một chỗ test khẳng định điều đó, vì lọc bớt là lỗi dễ
 * mắc nhất khi ai đó "dọn" danh sách trước khi vẽ (đúng luật `DoctorReport` doc-comment: danh sách
 * ngắn hơn đọc như một câu trả lời sạch thay vì một câu hỏi chưa từng được hỏi).
 */
export function doctorChecksInOrder(report: DoctorReport): DoctorReport["checks"] {
  return report.checks;
}

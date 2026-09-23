import type { PathReport } from "@mixengine/api";

/**
 * Dashboard có nhắc người dùng đưa `<root>/bin` vào PATH không.
 *
 * **Là trạng thái của máy, không phải một cờ đã lưu** — cùng lý do với `shouldOfferQuickStart`:
 * người vừa `mix path uninstall` sẽ thấy thẻ nhắc quay lại, và không có gì để reset.
 *
 * `null` nghĩa là report chưa về hoặc đọc hỏng, không phải "chưa cài".
 */
export function shouldOfferPathInstall(report: PathReport | null): boolean {
  return report !== null && !report.on_path;
}

/** Một lần install/uninstall có thật sự ghi vào đâu không. */
export type PathOutcome = "changed" | "unchanged";

/**
 * Đọc từ `PathPlace.changed` — cờ daemon đặt đúng cho câu hỏi này, để client nói "đã có sẵn" thay
 * vì nhận một lần ghi nó không làm. Chỉ khi có nơi đổi thật thì "mở terminal mới" mới có nghĩa.
 */
export function pathOutcome(report: PathReport): PathOutcome {
  return report.places.some((place) => place.changed) ? "changed" : "unchanged";
}

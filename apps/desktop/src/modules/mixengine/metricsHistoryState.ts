import type { MetricsMinute } from "./api/types/MetricsMinute";

const MINUTE_MS = 60_000;

/**
 * Chia `minutes` (đã sắp theo thời gian tăng dần) thành các đoạn liền kề.
 *
 * **Một phút vắng là ranh giới đoạn, không phải một điểm nối liền qua nó** — `MetricsHistory.minutes`
 * doc-comment: một phút không có dòng là một phút không ai đo (service dừng, máy ngủ, daemon đang
 * thay), không bao giờ là một phút dùng 0. Vẽ một đường nối hai đoạn là bịa ra dữ liệu chưa từng lấy.
 */
export function segmentsFor(minutes: readonly MetricsMinute[]): MetricsMinute[][] {
  const segments: MetricsMinute[][] = [];
  for (const minute of minutes) {
    const current = segments[segments.length - 1];
    const previous = current?.[current.length - 1];
    if (previous !== undefined && minute.minute - previous.minute === MINUTE_MS) {
      current.push(minute);
    } else {
      segments.push([minute]);
    }
  }
  return segments;
}

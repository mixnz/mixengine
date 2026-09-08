import type { MetricsFrame } from "./api/types/MetricsFrame";
import type { MetricsSample } from "./api/types/MetricsSample";

/**
 * Ghép một `ServiceId` với đúng chuỗi `MetricsSubject` bên MixEngine dùng trên dây.
 *
 * `"service:<id>"` — prefix `service:` là load-bearing, không phải trang trí: `ServiceId::parse`
 * chấp nhận tên trần, nên một service hoàn toàn có thể tên là `daemon`; dùng chung một spelling sẽ
 * gán lịch sử của daemon cho service đó. Type export phía TypeScript cố ý là `String` trần
 * (`ts(as = "String")`, `mixengine-proto/src/metrics.rs`) — ngữ pháp này chỉ tồn tại ở
 * `MetricsSubject::parse` phía Rust, không kiểm chứng được từ kiểu dữ liệu, nên client phải tự giữ
 * đúng một chỗ.
 */
export function metricsSubjectFor(serviceId: string): string {
  return `service:${serviceId}`;
}

/** Subject của chính daemon — không có `ServiceRow` tương ứng, vẽ riêng khỏi bảng service. */
export const DAEMON_SUBJECT = "daemon";

/** Parse một message thô từ `/metrics`. `null` nếu không phải một `MetricsFrame` hợp lệ. */
export function parseMetricsFrame(raw: string): MetricsFrame | null {
  try {
    const value = JSON.parse(raw) as { at?: unknown; samples?: unknown };
    if (typeof value.at !== "number" || !Array.isArray(value.samples)) return null;
    return value as unknown as MetricsFrame;
  } catch {
    return null;
  }
}

/**
 * Mẫu của một subject trong frame mới nhất, hoặc `null` nếu subject đó vắng mặt.
 *
 * **Vắng mặt trong frame không phải là 0** — một subject không đo được là một subject không nằm
 * trong `samples`, không phải một `MetricsSample` với các số 0 (`MetricsFrame` doc-comment). Gọi
 * chỗ này thay vì tự `find` là chỗ duy nhất giữ đúng luật đó.
 */
export function readingFor(frame: MetricsFrame | null, subject: string): MetricsSample | null {
  if (frame === null) return null;
  return frame.samples.find((sample) => sample.subject === subject) ?? null;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Một kích cỡ đọc được liếc qua. Một chữ số thập phân, bỏ luôn nếu là số tròn. */
export function formatBytes(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  const shown = unit === 0 ? String(size) : size.toFixed(1).replace(/\.0$/, "");
  return `${shown} ${BYTE_UNITS[unit]}`;
}

/** `cpu_percent` làm tròn 4 chữ số thập phân — `250` (hai lõi rưỡi) đọc thành `"250.0000%"`, giữ
 *  đúng độ chính xác daemon gửi thay vì cắt về số nguyên. */
export function formatPercent(value: number): string {
  return `${value.toFixed(4)}%`;
}

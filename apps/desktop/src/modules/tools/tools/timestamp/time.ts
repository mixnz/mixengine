export type TimeUnit = "seconds" | "millis" | "micros";

export interface TimeOutputs {
  isoUtc: string;
  isoLocal: string;
  unixSeconds: string;
  unixMillis: string;
  relative: string;
}

/**
 * Đơn vị của một dãy chữ số, đoán theo độ dài.
 *
 * Đoán là cần thiết — người ta dán một cột `bigint` vào đây mà không biết nó là giây hay mili —
 * nhưng đoán im lặng thì không: Panel hiển thị kết quả của hàm này để người dùng thấy nó đoán gì.
 */
export function detectUnit(input: string): TimeUnit | null {
  const digits = input.trim();
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length <= 11) return "seconds";
  if (digits.length <= 14) return "millis";
  if (digits.length <= 17) return "micros";
  return null;
}

const TO_MILLIS: Record<TimeUnit, number> = { seconds: 1000, millis: 1, micros: 1 / 1000 };

/** Mốc thời gian tính bằng mili, từ một dãy chữ số hoặc một chuỗi ISO 8601. */
export function toInstant(input: string): number | null {
  const text = input.trim();
  if (text === "") return null;

  const unit = detectUnit(text);
  if (unit) return Math.round(Number(text) * TO_MILLIS[unit]);

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

const DIVISIONS: [limit: number, size: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60_000, 1000, "second"],
  [3_600_000, 60_000, "minute"],
  [86_400_000, 3_600_000, "hour"],
  [2_592_000_000, 86_400_000, "day"],
  [31_536_000_000, 2_592_000_000, "month"],
  [Infinity, 31_536_000_000, "year"],
];

/**
 * `now` là tham số chứ không phải `Date.now()` bên trong: đó là thứ làm hàm này test được, và
 * cũng là thứ cho Panel đóng băng kết quả trong khi người dùng đang đọc nó.
 */
export function toOutputs(ms: number, timeZone: string, now: number): TimeOutputs {
  const date = new Date(ms);
  const diff = ms - now;

  let relative = "now";
  if (Math.abs(diff) >= 1000) {
    const [, size, unit] =
      DIVISIONS.find(([limit]) => Math.abs(diff) < limit) ?? DIVISIONS[DIVISIONS.length - 1];
    relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
      Math.round(diff / size),
      unit,
    );
  }

  return {
    isoUtc: date.toISOString(),
    // `sv-SE` cho ra `2026-08-28 07:00:00` — ISO trừ chữ T, thứ duy nhất trong các locale có sẵn
    // in ra dạng đọc được mà vẫn sắp xếp đúng.
    isoLocal: new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(date),
    unixSeconds: String(Math.floor(ms / 1000)),
    unixMillis: String(ms),
    relative,
  };
}

/**
 * Làm mờ dữ liệu nhạy cảm trong một tập object phẳng, để chia sẻ mẫu dữ liệu mà không lộ PII.
 *
 * Đây là làm mờ đơn giản cho việc export dữ liệu mẫu — **không phải** anonymization đạt chuẩn bảo
 * mật/GDPR. Mọi thứ chạy trong tiến trình này, không gửi đi đâu; `hash` là một hash không mã hoá
 * (FNV-1a), dò ngược được nếu tập giá trị gốc nhỏ (vd một số điện thoại cụ thể) — đủ để giữ tính
 * nhất quán giữa các dòng/bảng, không đủ để giấu một giá trị bí mật thật sự.
 */

export type MaskKind = "none" | "redact" | "partial" | "hash";

export const MASK_KINDS: MaskKind[] = ["none", "redact", "partial", "hash"];

/** Chỉ quyết định *cách* `partial` định dạng — không phải một danh mục hiện ra riêng cho người
 *  dùng chọn; người dùng chỉ chọn `MaskKind` per field. */
export type Shape = "email" | "phone" | "name" | "card" | "idNumber" | "dob" | "address" | "generic";

export interface FieldMaskSpec {
  name: string;
  shape: Shape;
  kind: MaskKind;
}

/** Đoán shape từ tên cột. Cột không khớp gì rơi vào `generic`, và shape đó mặc định kind `none` —
 *  im lặng bỏ qua một cột lạ an toàn hơn là mask nhầm một cột như `id`/`created_at`. */
export function detectShape(fieldName: string): Shape {
  const key = fieldName.toLowerCase();
  if (/email/.test(key)) return "email";
  if (/phone|sdt|dienthoai|mobile/.test(key)) return "phone";
  if (/card|the|ccnum|creditcard/.test(key)) return "card";
  if (/cmnd|cccd|idnumber|id_number|ssn|passport/.test(key)) return "idNumber";
  if (/ngay.?sinh|dob|birth/.test(key)) return "dob";
  if (/address|diachi/.test(key)) return "address";
  if (/name|ten|hoten|ho_ten/.test(key)) return "name";
  return "generic";
}

export function defaultKindForShape(shape: Shape): MaskKind {
  switch (shape) {
    case "email":
    case "phone":
    case "name":
    case "card":
    case "idNumber":
      return "partial";
    case "dob":
    case "address":
      return "redact";
    case "generic":
      return "none";
  }
}

/** Cột theo thứ tự xuất hiện lần đầu, hợp từ mọi dòng — dòng đầu thiếu một cột không giấu mất nó. */
export function detectFieldSpecs(rows: Record<string, unknown>[]): FieldMaskSpec[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns.map((name) => {
    const shape = detectShape(name);
    return { name, shape, kind: defaultKindForShape(shape) };
  });
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Giữ N chữ số cuối, thay phần trước bằng dấu sao — dùng cho phone/card/idNumber, khác nhau chỉ
 *  ở số chữ số giữ lại. */
function maskDigitsKeepingLast(text: string, keep: number): string {
  const digits = text.replace(/\D/g, "");
  if (digits.length <= keep) return "*".repeat(text.length);
  return "*".repeat(digits.length - keep) + digits.slice(-keep);
}

function maskGeneric(text: string): string {
  if (text.length <= 2) return "*".repeat(text.length);
  return text.slice(0, 1) + "*".repeat(text.length - 2) + text.slice(-1);
}

function maskPartial(text: string, shape: Shape): string {
  switch (shape) {
    case "email": {
      const at = text.indexOf("@");
      if (at <= 0) return maskGeneric(text);
      const local = text.slice(0, at);
      const domain = text.slice(at);
      const stars = "*".repeat(Math.max(local.length - 1, 3));
      return `${local.slice(0, 1)}${stars}${domain}`;
    }
    case "phone":
      return maskDigitsKeepingLast(text, 2);
    case "card":
    case "idNumber":
      return maskDigitsKeepingLast(text, 4);
    case "name":
      return text
        .trim()
        .split(/\s+/)
        .map((part) => `${part.slice(0, 1)}***`)
        .join(" ");
    case "dob":
    case "address":
    case "generic":
      return maskGeneric(text);
  }
}

/**
 * Áp một `MaskKind` lên một giá trị. Giá trị rỗng (`null`/`undefined`/`""`) không có gì để giấu,
 * nên đi qua nguyên vẹn bất kể `kind` — che một ô vốn đã trống chỉ tạo cảm giác có dữ liệu ở đó.
 *
 * `none` là kind duy nhất giữ nguyên kiểu gốc; ba kind còn lại luôn trả về chuỗi, kể cả khi đầu vào
 * là số hay boolean — một số điện thoại có thể được lưu dưới dạng số, và kết quả làm mờ nó không
 * còn là một số nữa.
 */
export function maskValue(value: unknown, kind: MaskKind, shape: Shape): unknown {
  if (kind === "none" || value === null || value === undefined || value === "") return value;
  const text = String(value);
  switch (kind) {
    case "redact":
      return "***";
    case "hash":
      return `h_${fnv1a(text)}`;
    case "partial":
      return maskPartial(text, shape);
  }
}

export function maskRows(
  rows: Record<string, unknown>[],
  specs: FieldMaskSpec[],
): Record<string, unknown>[] {
  const bySpec = new Map(specs.map((spec) => [spec.name, spec]));
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const spec = bySpec.get(key);
      out[key] = spec ? maskValue(value, spec.kind, spec.shape) : value;
    }
    return out;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlat(row: Record<string, unknown>): boolean {
  return Object.values(row).every((value) => !isRecord(value) && !Array.isArray(value));
}

/**
 * Chuẩn hoá một JSON đã parse thành mảng object phẳng, hoặc `null` nếu không đọc được — kể cả khi
 * chỉ một field bị lồng. Bỏ qua âm thầm field lồng thay vì báo lỗi sẽ khiến người dùng tưởng mọi
 * cột đã được xét mask, trong khi có cột chưa từng được nhìn tới.
 */
export function parseFlatRows(parsed: unknown): Record<string, unknown>[] | null {
  const rows = Array.isArray(parsed) ? parsed : isRecord(parsed) ? [parsed] : null;
  if (rows === null || rows.length === 0) return null;
  if (!rows.every(isRecord)) return null;
  const records = rows as Record<string, unknown>[];
  return records.every(isFlat) ? records : null;
}

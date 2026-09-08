import { parseCsvRows, rowsToObjects, toCsv } from "../shared/csv";
import { toInsert, type SqlDialect } from "./insert";

/**
 * Trục của tool Chuyển đổi: mọi định dạng vào đều thành một giá trị JS, mọi định dạng ra đều sinh
 * từ giá trị đó. Ba bộ đọc cộng bốn bộ ghi, không phải mười hai hàm dịch chéo.
 *
 * Cái giá là mất những gì trục không mang được — comment của YAML, và độ chính xác của số trong
 * JSON. Cái sau được nói ra bằng `warnings`; tool Format thì tránh hẳn bằng cách không đi qua đây.
 */

export type ReadFormat = "json" | "yaml" | "csv";
export type WriteFormat = "json" | "yaml" | "csv" | "insert";

export interface ConvertOptions {
  delimiter: string;
  header: boolean;
  table: string;
  dialect: SqlDialect;
  multiRow: boolean;
}

export type ConvertFailure =
  | { reason: "empty" | "same" | "needsRows" }
  | { reason: "parse"; detail: string };

export type ConvertResult =
  | { ok: true; output: string; warnings: "precision"[] }
  | { ok: false; failure: ConvertFailure };

/** Số nguyên từ 16 chữ số trở lên không sống sót qua `JSON.parse`. */
const LONG_INTEGER = /(^|[^\w.])-?\d{16,}([^\d.]|$)/;

/** CSV và INSERT cần một mảng object mà mọi giá trị đều là ô đơn. */
function isFlatObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        !Array.isArray(row) &&
        Object.values(row as Record<string, unknown>).every(
          (cell) => cell === null || typeof cell !== "object",
        ),
    )
  );
}

async function read(text: string, from: ReadFormat, options: ConvertOptions): Promise<unknown> {
  if (from === "json") return JSON.parse(text);
  if (from === "yaml") {
    // Nạp ở lần dùng đầu, không phải lúc mở tab — đúng cách `node-sql-parser` được nạp ở giai đoạn 2.
    const yaml = await import("js-yaml");
    return yaml.load(text);
  }
  const rows = parseCsvRows(text, options.delimiter);
  return options.header ? rowsToObjects(rows) : rows;
}

async function write(value: unknown, to: WriteFormat, options: ConvertOptions): Promise<string> {
  if (to === "json") return JSON.stringify(value, null, 2);
  if (to === "yaml") {
    const yaml = await import("js-yaml");
    return yaml.dump(value, { noRefs: true, lineWidth: -1 });
  }
  const rows = value as Record<string, unknown>[];
  if (to === "csv") return toCsv(rows, options.delimiter, options.header);
  return toInsert(rows, {
    table: options.table,
    dialect: options.dialect,
    multiRow: options.multiRow,
  });
}

export async function convertData(
  text: string,
  from: ReadFormat,
  to: WriteFormat,
  options: ConvertOptions,
): Promise<ConvertResult> {
  if (text.trim() === "") return { ok: false, failure: { reason: "empty" } };
  if ((from as string) === (to as string)) return { ok: false, failure: { reason: "same" } };

  let value: unknown;
  try {
    value = await read(text, from, options);
  } catch (error) {
    return {
      ok: false,
      failure: { reason: "parse", detail: error instanceof Error ? error.message : String(error) },
    };
  }

  // Không xuất kết quả một phần: một bảng CSV thiếu mất cột lồng nhau trông y hệt một bảng đúng.
  if ((to === "csv" || to === "insert") && !isFlatObjectArray(value)) {
    return { ok: false, failure: { reason: "needsRows" } };
  }

  const warnings: "precision"[] = from === "json" && LONG_INTEGER.test(text) ? ["precision"] : [];
  return { ok: true, output: await write(value, to, options), warnings };
}

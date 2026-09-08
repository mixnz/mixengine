/**
 * CSV theo RFC 4180, cả hai chiều, tự viết.
 *
 * Phần khó nằm đúng ở dấu ngoặc kép: một trường có ngoặc thì dấu phân cách, xuống dòng và cả ngoặc
 * kép đôi `""` đều nằm được bên trong nó. Đó là lý do không có `split(",")` ở đây.
 *
 * Dùng chung giữa `convert` và `mask` — cả hai đều cần đọc/ghi CSV, và RFC 4180 đủ rắc rối để không
 * đáng chép lại lần thứ hai.
 */

/** Đọc CSV ra lưới chuỗi. **Không đoán kiểu** — `007` là `"007"`, không phải `7`. */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };

  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      started = true;
      i += 1;
    } else if (ch === delimiter) {
      endField();
      started = true;
      i += 1;
    } else if (ch === "\r") {
      i += 1;
    } else if (ch === "\n") {
      endRow();
      i += 1;
    } else {
      field += ch;
      started = true;
      i += 1;
    }
  }

  // Không có dòng thừa khi file kết thúc bằng một lần xuống dòng.
  if (started || field !== "" || row.length > 0) endRow();
  return rows;
}

/** Dòng đầu là tên cột. Dòng trống hoàn toàn bị bỏ — nó là dòng trắng, không phải bản ghi rỗng. */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const header = rows[0];
  if (!header) return [];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      header.forEach((name, index) => {
        record[name] = row[index] ?? "";
      });
      return record;
    });
}

export function toCsv(
  values: Record<string, unknown>[],
  delimiter: string,
  header: boolean,
): string {
  const columns: string[] = [];
  for (const row of values) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    const needsQuotes = text.includes(delimiter) || /["\n\r]/.test(text);
    return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = values.map((row) => columns.map((name) => cell(row[name])).join(delimiter));
  return header ? [columns.map(cell).join(delimiter), ...lines].join("\n") : lines.join("\n");
}

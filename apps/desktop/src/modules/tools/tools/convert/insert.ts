/**
 * Sinh câu lệnh `INSERT` từ một mảng object.
 *
 * Đầu ra là thứ để **đọc và dán tay**, không phải cách thay cho truy vấn tham số hoá — tool không
 * biết dữ liệu đến từ đâu. Panel nói điều đó ra thành một dòng dưới ô kết quả.
 */

export type SqlDialect = "mysql" | "postgres";

export interface InsertOptions {
  table: string;
  dialect: SqlDialect;
  /** Một câu lệnh với nhiều dòng `VALUES`, thay vì mỗi dòng một câu lệnh. */
  multiRow: boolean;
}

function quoteIdent(name: string, dialect: SqlDialect): string {
  return dialect === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
}

/**
 * Bọc một chuỗi thành literal SQL.
 *
 * **Hai dialect escape khác nhau, và đây là chỗ sai mà chạy êm.** MySQL coi `\` là ký tự escape
 * trong chuỗi (mặc định, khi `NO_BACKSLASH_ESCAPES` tắt), nên nó phải được nhân đôi — bỏ qua thì
 * `C:\new\table` vào DB thành một ký tự xuống dòng và một tab. PostgreSQL với
 * `standard_conforming_strings` bật (mặc định từ 9.1) thì không, và nhân đôi ở đó là ghi thừa một
 * dấu `\` vào dữ liệu.
 */
function quoteText(value: string, dialect: SqlDialect): string {
  const escaped = dialect === "mysql" ? value.replace(/\\/g, "\\\\") : value;
  return `'${escaped.replace(/'/g, "''")}'`;
}

function literal(value: unknown, dialect: SqlDialect): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return quoteText(JSON.stringify(value), dialect);
  return quoteText(String(value), dialect);
}

export function toInsert(rows: Record<string, unknown>[], options: InsertOptions): string {
  if (rows.length === 0) return "";

  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  const head = `INSERT INTO ${quoteIdent(options.table, options.dialect)} (${columns
    .map((name) => quoteIdent(name, options.dialect))
    .join(", ")})`;
  const tuples = rows.map(
    (row) => `(${columns.map((name) => literal(row[name], options.dialect)).join(", ")})`,
  );

  if (options.multiRow) {
    return `${head} VALUES\n${tuples.map((tuple) => `  ${tuple}`).join(",\n")};`;
  }
  return tuples.map((tuple) => `${head} VALUES ${tuple};`).join("\n");
}

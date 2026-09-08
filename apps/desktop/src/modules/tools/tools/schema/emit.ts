import { convert } from "../case/caseConvert";
import type { SqlDialect } from "../convert/insert";
import type { Field, JsonType } from "./infer";

/**
 * Ba bộ sinh mã từ kết quả của `inferSchema`.
 *
 * Đặt tên dùng lại `convert()` của tool Đổi kiểu chữ — `snake_case` cho cột SQL, `PascalCase` cho
 * field Go, giữ nguyên cho TypeScript. Đây là lần đầu hai tool trong module gọi nhau, và nó đi
 * đúng chiều: logic thuần gọi logic thuần.
 */

export interface CreateTableOptions {
  table: string;
  dialect: SqlDialect;
}

/** Kiểu duy nhất của một trường, đã bỏ `null` ra. `null` nghĩa là trộn nhiều kiểu hoặc chỉ có null. */
function soleType(field: Field): JsonType | null {
  const types = field.types.filter((type) => type !== "null");
  return types.length === 1 ? types[0]! : null;
}

function nullable(field: Field): boolean {
  return field.optional || field.types.includes("null");
}

function sqlType(field: Field, dialect: SqlDialect): string {
  const type = soleType(field);
  if (type === null) return "TEXT";
  if (type === "object" || type === "array") return dialect === "mysql" ? "JSON" : "JSONB";
  if (type === "boolean") return dialect === "mysql" ? "TINYINT(1)" : "BOOLEAN";
  // Mẫu chỉ là mẫu: một cột INT tràn ở bản ghi thứ hai tỉ là chuyện sửa lúc production.
  if (type === "integer") return "BIGINT";
  if (type === "number") return dialect === "mysql" ? "DOUBLE" : "DOUBLE PRECISION";
  if (type === "string") {
    if (field.isoLike) return dialect === "mysql" ? "DATETIME" : "TIMESTAMPTZ";
    return "VARCHAR(255)";
  }
  return "TEXT";
}

export function toCreateTable(fields: Field[], options: CreateTableOptions): string {
  const ident = (name: string): string =>
    options.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const lines = fields.map((field) => {
    const column = ident(convert(field.name, "snake"));
    const suffix = nullable(field) ? "" : " NOT NULL";
    return `  ${column} ${sqlType(field, options.dialect)}${suffix}`;
  });
  // Tên bảng giữ nguyên như người dùng gõ — họ đã chọn nó rồi.
  return `CREATE TABLE ${ident(options.table)} (\n${lines.join(",\n")}\n);`;
}

const TS_TYPE: Record<JsonType, string> = {
  string: "string",
  number: "number",
  integer: "number",
  boolean: "boolean",
  null: "null",
  object: "Record<string, unknown>",
  array: "unknown[]",
  unknown: "unknown",
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function toTypeScript(fields: Field[], rootName: string): string {
  const blocks: string[] = [];

  function emit(list: Field[], name: string): void {
    const lines = list.map((field) => {
      const key = IDENTIFIER.test(field.name) ? field.name : JSON.stringify(field.name);
      return `  ${key}${field.optional ? "?" : ""}: ${tsType(field, name)};`;
    });
    blocks.push(`export interface ${name} {\n${lines.join("\n")}\n}`);
  }

  function tsType(field: Field, parent: string): string {
    const suffix = field.types.includes("null") ? " | null" : "";
    const type = soleType(field);
    if (type === null) return `unknown${suffix}`;
    if ((type === "object" || type === "array") && field.children) {
      const child = `${parent}${convert(field.name, "pascal")}`;
      emit(field.children, child);
      return type === "array" ? `${child}[]${suffix}` : `${child}${suffix}`;
    }
    return `${TS_TYPE[type]}${suffix}`;
  }

  emit(fields, rootName);
  // `emit` đẩy block cha vào sau các block con nó sinh ra, nên đảo lại để root đứng đầu.
  return blocks.reverse().join("\n\n");
}

const GO_TYPE: Record<JsonType, string> = {
  string: "string",
  number: "float64",
  integer: "int64",
  boolean: "bool",
  null: "any",
  object: "map[string]any",
  array: "[]any",
  unknown: "any",
};

export function toGoStruct(fields: Field[], rootName: string): string {
  const blocks: string[] = [];

  function emit(list: Field[], name: string): void {
    const lines = list.map(
      (field) =>
        `\t${convert(field.name, "pascal")} ${goType(field, name)} \`json:"${field.name}"\``,
    );
    blocks.push(`type ${name} struct {\n${lines.join("\n")}\n}`);
  }

  function goType(field: Field, parent: string): string {
    const pointer = nullable(field) ? "*" : "";
    const type = soleType(field);
    if (type === null) return "any";
    if ((type === "object" || type === "array") && field.children) {
      const child = `${parent}${convert(field.name, "pascal")}`;
      emit(field.children, child);
      // Slice đã là kiểu nil được rồi, nên không thêm con trỏ.
      return type === "array" ? `[]${child}` : `${pointer}${child}`;
    }
    return type === "array" ? "[]any" : `${pointer}${GO_TYPE[type]}`;
  }

  emit(fields, rootName);
  return blocks.reverse().join("\n\n");
}

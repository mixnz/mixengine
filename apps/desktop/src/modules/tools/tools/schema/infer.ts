/**
 * Suy ra hình dạng của một mẫu JSON.
 *
 * Đây là phần đáng test của tool Sinh schema; ba bộ sinh mã ở `emit.ts` chỉ in ra thứ hàm này đã
 * kết luận. Mẫu là một object, hoặc một mảng object — mảng thì hợp các khoá lại và khoá nào vắng
 * mặt ở một phần tử là khoá `optional`.
 */

export type JsonType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null"
  | "object"
  | "array"
  | "unknown";

export interface Field {
  /** Khoá đúng như trong JSON. Đổi tên là việc của bộ sinh mã. */
  name: string;
  types: JsonType[];
  /** Khoá vắng mặt ở ít nhất một phần tử của mảng mẫu. */
  optional: boolean;
  /** Mọi giá trị chuỗi đã thấy đều trông như ISO 8601 — cột thời gian, không phải `VARCHAR`. */
  isoLike: boolean;
  /** Với object: các trường con. Với mảng object: hình dạng của phần tử. */
  children?: Field[];
}

/**
 * Chặt hơn `Date.parse` một cách có chủ đích.
 *
 * `timestamp/time.ts` không có hàm nhận diện ISO nào để dùng lại — nó gọi `Date.parse`, mà
 * `Date.parse("2026")` là hợp lệ. Một cột chứa toàn chuỗi bốn chữ số không phải cột thời gian.
 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  return "unknown";
}

function widen(types: JsonType[]): JsonType[] {
  if (types.includes("number") && types.includes("integer")) {
    return types.filter((type) => type !== "integer");
  }
  return types;
}

function childrenOf(values: unknown[]): Field[] | undefined {
  const objects = values.filter(isRecord);
  if (objects.length > 0) return fieldsOf(objects);
  const items = values.filter(Array.isArray).flat().filter(isRecord);
  if (items.length > 0) return fieldsOf(items);
  return undefined;
}

function fieldsOf(samples: Record<string, unknown>[]): Field[] {
  const order: string[] = [];
  const bag = new Map<string, unknown[]>();

  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample)) {
      let values = bag.get(key);
      if (!values) {
        values = [];
        bag.set(key, values);
        order.push(key);
      }
      values.push(value);
    }
  }

  return order.map((name) => {
    const values = bag.get(name)!;
    const types: JsonType[] = [];
    for (const value of values) {
      const type = typeOf(value);
      if (!types.includes(type)) types.push(type);
    }
    const strings = values.filter((value): value is string => typeof value === "string");
    const field: Field = {
      name,
      types: widen(types),
      optional: values.length < samples.length,
      isoLike: strings.length > 0 && strings.every((value) => ISO_8601.test(value)),
    };
    const children = childrenOf(values);
    if (children) field.children = children;
    return field;
  });
}

export function inferSchema(value: unknown): Field[] | null {
  if (isRecord(value)) return fieldsOf([value]);
  if (Array.isArray(value)) {
    const rows = value.filter(isRecord);
    return rows.length > 0 ? fieldsOf(rows) : null;
  }
  return null;
}

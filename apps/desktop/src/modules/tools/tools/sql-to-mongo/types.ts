export type Dialect = "mysql" | "postgresql";

/** Một mệnh đề không dịch được. Nó **thay cho** đầu ra, không đi kèm đầu ra. */
export interface Unsupported {
  code:
    | "join"
    | "subquery"
    | "union"
    | "cte"
    | "window"
    | "dml"
    | "case"
    | "function"
    | "multi"
    | "parse";
  /** Đoạn SQL gây ra, để Panel chỉ đúng chỗ thay vì chỉ nói "không hỗ trợ". */
  fragment: string;
}

/** Một chỗ dịch được nhưng ngữ nghĩa Mongo không trùng SQL. Nó **đi kèm** đầu ra. */
export interface Warning {
  code: "isNull" | "type" | "objectId" | "starWithGroupBy";
  /** Trường hoặc đoạn SQL mà cảnh báo nói về. */
  fragment: string;
}

/**
 * Kết quả của một lần dịch.
 *
 * Hai nhánh, không phải một object có cả `output` lẫn `unsupported`: **không bao giờ xuất kết quả
 * một phần**. Một truy vấn rụng mất `HAVING` trông y hệt một truy vấn đúng, và có người sẽ chạy nó
 * trên production.
 *
 * `Unsupported` và `Warning` cùng mang `fragment` nhưng nằm ở hai nhánh khác nhau, và đó là chủ ý:
 * cái thứ nhất *thay cho* đầu ra, cái thứ hai *đi kèm* đầu ra. Gộp hai thứ vào một danh sách là
 * bước đầu để một ngày nào đó xuất kết quả một phần.
 */
export type Translation =
  | { ok: true; output: string; warnings: Warning[] }
  | { ok: false; unsupported: Unsupported[] };

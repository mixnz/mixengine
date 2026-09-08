/** Mọi ký tự có nghĩa trong regex, để escape từng cái một. */
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Một mẫu `LIKE` của SQL thành mẫu regex của Mongo.
 *
 * Việc escape ở đây không phải cẩn thận thừa: `LIKE 'a.b%'` mà quên escape dấu chấm thì thành một
 * truy vấn khác hẳn — vẫn chạy, vẫn ra kết quả, chỉ là kết quả sai. Đó là loại lỗi không ai bắt
 * được bằng mắt.
 *
 * Neo `^`/`$` chỉ bỏ đúng ở đầu nào có `%`: `LIKE 'abc'` trong SQL là bằng chính xác, không phải
 * chứa. Escape chạy **trước** khi `%` và `_` được đổi, nếu không thì `.*` vừa sinh ra sẽ bị escape
 * thành `\.\*` ngay sau đó.
 */
export function likeToRegex(pattern: string): string {
  const startsAny = pattern.startsWith("%");
  const endsAny = pattern.length > 1 && pattern.endsWith("%");

  const body = pattern
    .slice(startsAny ? 1 : 0, endsAny ? pattern.length - 1 : undefined)
    .replace(SPECIAL, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");

  // `LIKE '%'` khớp mọi thứ. `.*$` cũng vậy, nhưng cái neo ở đuôi chỉ tổ làm người đọc dừng lại
  // hỏi nó để làm gì.
  if (startsAny && body === "") return ".*";

  return `${startsAny ? ".*" : "^"}${body}${endsAny ? ".*" : "$"}`;
}

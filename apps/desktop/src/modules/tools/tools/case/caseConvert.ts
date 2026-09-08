export type CaseStyle = "camel" | "snake" | "kebab" | "pascal" | "constant" | "dot" | "title";

export const CASE_STYLES: CaseStyle[] = [
  "camel",
  "snake",
  "kebab",
  "pascal",
  "constant",
  "dot",
  "title",
];

/**
 * Một chuỗi tách thành các từ viết thường.
 *
 * Mọi lớp ký tự ở đây là thuộc tính Unicode chứ không phải `a-zA-Z`: `\p{Ll}` là chữ thường,
 * `\p{Lu}` là chữ hoa, `\p{L}` là chữ nói chung và `\p{N}` là chữ số. Bảng `a-zA-Z` coi mọi chữ
 * có dấu là dấu ngăn, nên `"có gì hot"` ra `c_g_hot` và `"Xin chào bạn"` ra năm mảnh — chữ Việt
 * biến mất khỏi chính cái tên đang được đổi.
 *
 * `\p{L}` cũng nhận chữ Hán, Kirin, Hy Lạp… Chúng không có khái niệm hoa/thường nên chỉ đơn giản
 * là đi qua nguyên vẹn, đó là điều đúng đắn duy nhất làm được với chúng.
 *
 * Thứ tự ba phép thay là quan trọng và đã được test khoá lại:
 *
 * 1. Chèn khoảng trắng trước chữ số — `user2FA` thành `user 2FA`, chứ không phải `user2 FA`.
 * 2. Tách thường-rồi-hoa — `fooBar` thành `foo Bar`. Cố tình **không** nhận chữ số ở vế trái, nếu
 *    không thì `2FA` vừa ghép lại sẽ bị xé ra ngay.
 * 3. Tách cụm hoa khỏi từ theo sau — `HTTPResponse` thành `HTTP Response`, thứ mà một phép tách
 *    hoa-thường ngây thơ biến thành `h_t_t_p_response`.
 */
export function splitWords(input: string): string[] {
  return input
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

const upperFirst = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Một dòng đổi sang một kiểu. Dòng không có từ nào trả về nguyên trạng — xoá trắng một dòng
 *  người dùng vừa dán vào là mất dữ liệu, dù chỉ là một dòng cách. */
export function convert(line: string, style: CaseStyle): string {
  const words = splitWords(line);
  if (words.length === 0) return line;

  switch (style) {
    case "camel":
      return words[0] + words.slice(1).map(upperFirst).join("");
    case "snake":
      return words.join("_");
    case "kebab":
      return words.join("-");
    case "pascal":
      return words.map(upperFirst).join("");
    case "constant":
      return words.join("_").toUpperCase();
    case "dot":
      return words.join(".");
    case "title":
      return words.map(upperFirst).join(" ");
  }
}

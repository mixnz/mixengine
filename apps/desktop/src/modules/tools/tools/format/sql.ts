/**
 * Gom một câu lệnh SQL về một dòng.
 *
 * Không phải parser, nhưng **phải hiểu chuỗi và comment**: gom khoảng trắng bên trong `'…'` là đổi
 * dữ liệu, và bỏ nửa dòng `-- …` là biến phần đuôi câu lệnh thành comment.
 */

const WS = " \t\n\r";

export function minifySql(text: string): string {
  const out: string[] = [];
  let i = 0;
  let pending = false;

  const emit = (chunk: string): void => {
    if (pending && out.length > 0) out.push(" ");
    pending = false;
    out.push(chunk);
  };

  /** Đọc trọn một chuỗi hoặc định danh có ngoặc, kể cả `''` lồng bên trong. */
  const readQuoted = (quote: string): string => {
    const start = i;
    i += 1;
    while (i < text.length) {
      if (text[i] === "\\" && quote !== "`") {
        i += 2;
        continue;
      }
      if (text[i] === quote) {
        if (text[i + 1] === quote) {
          i += 2;
          continue;
        }
        i += 1;
        return text.slice(start, i);
      }
      i += 1;
    }
    // Chưa đóng: trả nốt phần còn lại. Minify không có việc từ chối một câu lệnh.
    return text.slice(start, i);
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      emit(readQuoted(ch));
    } else if (text.startsWith("--", i) || ch === "#") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      pending = true;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      pending = true;
    } else if (WS.includes(ch)) {
      i += 1;
      pending = true;
    } else {
      emit(ch);
      i += 1;
    }
  }

  return out.join("").trim();
}

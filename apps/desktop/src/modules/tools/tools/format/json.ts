/**
 * Format và minify JSON **mà không đi qua `JSON.parse`**.
 *
 * `JSON.parse` rồi `stringify` làm hỏng dữ liệu im lặng, đúng với thứ người ta hay dán vào module
 * này: `1787875200123456789` thành `…800`, `{"2":…,"1":…}` bị sắp lại, `1.50` thành `1.5`, và
 * `"A"` thành `"A"`. Không cái nào báo lỗi.
 *
 * Nên ở đây chỉ có một bộ tách token in lại khoảng trắng: mọi token được phát lại đúng **lát cắt
 * nguồn** của nó, và không con số nào đi qua `Number`. Minify là cùng hàm đó với thụt lề rỗng.
 */

export interface JsonSyntaxError {
  /** Vị trí ký tự trong nguồn; dòng và cột suy ra từ nó, để Panel chỉ đúng chỗ. */
  index: number;
  line: number;
  column: number;
  message: string;
}

export type JsonResult = { ok: true; output: string } | { ok: false; error: JsonSyntaxError };

/** Ném bên trong `render`, bắt lại ở `run`. Riêng tư của file này. */
class ScanError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
  }
}

const WS = " \t\n\r";

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function render(text: string, indent: string): string {
  let i = 0;
  const out: string[] = [];
  const nl = indent === "" ? "" : "\n";
  const gap = indent === "" ? "" : " ";

  const skipWs = (): void => {
    while (i < text.length && WS.includes(text[i]!)) i += 1;
  };

  const expect = (ch: string): void => {
    if (text[i] !== ch) throw new ScanError(i, `Cần "${ch}"`);
    i += 1;
  };

  const readString = (): string => {
    const start = i;
    i += 1;
    while (i < text.length) {
      const ch = text[i]!;
      // Escape đi qua nguyên văn — mở nó ra là đổi nguồn.
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return text.slice(start, i);
      }
      if (ch === "\n") break;
      i += 1;
    }
    throw new ScanError(start, "Chuỗi chưa đóng");
  };

  const readNumber = (): string => {
    const start = i;
    if (text[i] === "-") i += 1;
    if (!isDigit(text[i])) throw new ScanError(start, "Không đọc được giá trị");
    while (isDigit(text[i])) i += 1;
    if (text[i] === ".") {
      i += 1;
      while (isDigit(text[i])) i += 1;
    }
    if (text[i] === "e" || text[i] === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      while (isDigit(text[i])) i += 1;
    }
    // Lát cắt nguồn. `Number` không bao giờ chạm vào con số này.
    return text.slice(start, i);
  };

  const readWord = (): string => {
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return word;
      }
    }
    throw new ScanError(i, "Không đọc được giá trị");
  };

  function value(depth: number): void {
    skipWs();
    const ch = text[i];
    if (ch === undefined) throw new ScanError(i, "Hết dữ liệu giữa chừng");
    if (ch === "{") object(depth);
    else if (ch === "[") array(depth);
    else if (ch === '"') out.push(readString());
    else if (ch === "-" || isDigit(ch)) out.push(readNumber());
    else out.push(readWord());
  }

  function object(depth: number): void {
    expect("{");
    skipWs();
    if (text[i] === "}") {
      i += 1;
      out.push("{}");
      return;
    }
    out.push("{", nl);
    for (;;) {
      skipWs();
      if (text[i] !== '"') throw new ScanError(i, "Khoá phải là chuỗi trong ngoặc kép");
      out.push(indent.repeat(depth + 1), readString(), ":", gap);
      skipWs();
      expect(":");
      value(depth + 1);
      skipWs();
      if (text[i] !== ",") break;
      i += 1;
      out.push(",", nl);
    }
    out.push(nl, indent.repeat(depth));
    expect("}");
    out.push("}");
  }

  function array(depth: number): void {
    expect("[");
    skipWs();
    if (text[i] === "]") {
      i += 1;
      out.push("[]");
      return;
    }
    out.push("[", nl);
    for (;;) {
      out.push(indent.repeat(depth + 1));
      value(depth + 1);
      skipWs();
      if (text[i] !== ",") break;
      i += 1;
      out.push(",", nl);
    }
    out.push(nl, indent.repeat(depth));
    expect("]");
    out.push("]");
  }

  skipWs();
  if (i >= text.length) throw new ScanError(0, "Không có gì để đọc");
  value(0);
  skipWs();
  if (i < text.length) throw new ScanError(i, "Còn ký tự thừa sau giá trị");
  return out.join("");
}

function locate(text: string, index: number, message: string): JsonSyntaxError {
  let line = 1;
  let column = 1;
  for (let k = 0; k < index && k < text.length; k += 1) {
    if (text[k] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { index, line, column, message };
}

function run(text: string, indent: string): JsonResult {
  try {
    return { ok: true, output: render(text, indent) };
  } catch (error) {
    if (!(error instanceof ScanError)) throw error;
    return { ok: false, error: locate(text, error.index, error.message) };
  }
}

/** `indent` là chuỗi thụt lề một cấp: `"  "`, `"    "` hoặc `"\t"`. */
export function formatJson(text: string, indent: string): JsonResult {
  return run(text, indent);
}

export function minifyJson(text: string): JsonResult {
  return run(text, "");
}

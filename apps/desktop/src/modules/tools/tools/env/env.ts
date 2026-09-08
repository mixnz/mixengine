/**
 * Đọc và ghi biến môi trường ở bốn dạng.
 *
 * Trục là một **danh sách có thứ tự**, không phải `Record`: thứ tự dòng trong `.env` là thứ người
 * viết cố ý, và đảo nó là làm phiền người đọc lần sau.
 *
 * Đây là tool mà người dùng gần như chắc chắn dán mật khẩu DB vào. Nó không lưu gì cả, như mọi
 * tool khác trong module.
 */

export interface EnvPair {
  key: string;
  value: string;
}

/** Vị trí dấu ngoặc đóng, bỏ qua ngoặc đã bị escape. `-1` nghĩa là giá trị còn trải sang dòng sau. */
function closingIndex(body: string, quote: string): number {
  for (let i = 0; i < body.length; i += 1) {
    if (quote === '"' && body[i] === "\\") {
      i += 1;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

function unescapeDouble(raw: string): string {
  return raw.replace(/\\(.)/g, (_match, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    return ch;
  });
}

export function parseEnv(text: string): EnvPair[] {
  const pairs: EnvPair[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    let line = lines[i]!.trim();
    i += 1;
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === "") continue;

    const rest = line.slice(eq + 1);
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let body = rest.slice(1);
      // Giá trị trong ngoặc được phép trải nhiều dòng.
      while (closingIndex(body, quote) === -1 && i < lines.length) {
        body += `\n${lines[i]!}`;
        i += 1;
      }
      const end = closingIndex(body, quote);
      const raw = end === -1 ? body : body.slice(0, end);
      pairs.push({ key, value: quote === '"' ? unescapeDouble(raw) : raw });
      continue;
    }

    // Không ngoặc: phần sau ` #` là comment, không phải giá trị.
    const hash = rest.indexOf(" #");
    pairs.push({ key, value: (hash === -1 ? rest : rest.slice(0, hash)).trim() });
  }

  return pairs;
}

export function parseJsonEnv(text: string): EnvPair[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.entries(value as Record<string, unknown>).map(([key, raw]) => ({
    key,
    value:
      raw === null || raw === undefined
        ? ""
        : typeof raw === "object"
          ? JSON.stringify(raw)
          : String(raw),
  }));
}

const NEEDS_QUOTES = /[\s#"'\\]/;

function envValue(value: string): string {
  if (value === "" || !NEEDS_QUOTES.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function toEnv(pairs: EnvPair[]): string {
  return pairs.map((pair) => `${pair.key}=${envValue(pair.value)}`).join("\n");
}

export function toExport(pairs: EnvPair[]): string {
  return pairs.map((pair) => `export ${pair.key}=${envValue(pair.value)}`).join("\n");
}

export function toJsonEnv(pairs: EnvPair[]): string {
  const record: Record<string, string> = {};
  for (const pair of pairs) record[pair.key] = pair.value;
  return JSON.stringify(record, null, 2);
}

/** Đầu ra được dán vào một dòng lệnh thật, nên bọc theo luật shell: ngoặc đơn, và dấu nháy đơn bên
 *  trong phải đóng chuỗi, escape, rồi mở lại. */
function shellValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function toDockerArgs(pairs: EnvPair[]): string {
  return pairs.map((pair) => `-e ${pair.key}=${shellValue(pair.value)}`).join(" ");
}

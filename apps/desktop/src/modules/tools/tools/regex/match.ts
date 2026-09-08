/**
 * Chạy một regex và thu kết quả. Hàm thuần — phần chạy nó trong Worker nằm ở `run.ts`.
 *
 * Tách ra đúng ở đây vì đây là ranh giới test được: vòng lặp thu match chạy trong Node, còn
 * `Worker` thì không tồn tại ở đó.
 */

export interface RegexGroup {
  /** `null` cho nhóm theo số. Nhóm có tên được liệt kê riêng, với `index` là `-1`. */
  name: string | null;
  index: number;
  text: string | null;
}

export interface RegexMatch {
  index: number;
  text: string;
  groups: RegexGroup[];
}

export type RegexRun =
  | { ok: true; matches: RegexMatch[]; truncated: boolean; replaced: string | null }
  | { ok: false; message: string };

/** Đủ để nhìn, và giữ payload gửi qua khỏi Worker ở mức có nghĩa. */
const MAX_MATCHES = 500;

function toMatch(found: RegExpExecArray): RegexMatch {
  const groups: RegexGroup[] = [];
  for (let i = 1; i < found.length; i += 1) {
    groups.push({ name: null, index: i, text: found[i] ?? null });
  }
  for (const [name, text] of Object.entries(found.groups ?? {})) {
    groups.push({ name, index: -1, text: text ?? null });
  }
  return { index: found.index, text: found[0]!, groups };
}

export function runRegex(
  pattern: string,
  flags: string,
  subject: string,
  replacement: string,
): RegexRun {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (error) {
    // Thông báo của engine đã chỉ đúng chỗ; viết lại chỉ làm mờ đi.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const matches: RegexMatch[] = [];
  let truncated = false;

  if (re.global || re.sticky) {
    re.lastIndex = 0;
    for (;;) {
      const found = re.exec(subject);
      if (!found) break;
      matches.push(toMatch(found));
      // Mẫu khớp rỗng làm `lastIndex` đứng yên và `exec` trả về mãi mãi.
      if (found[0] === "") re.lastIndex += 1;
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
    }
  } else {
    const found = re.exec(subject);
    if (found) matches.push(toMatch(found));
  }

  re.lastIndex = 0;
  const replaced = replacement === "" ? null : subject.replace(re, replacement);
  return { ok: true, matches, truncated, replaced };
}

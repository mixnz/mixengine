import { DEFAULT_FONT_SIZE, stepFontSize } from "./fontSize";

/** Kiểu con trỏ. Đúng ba giá trị `ITerminalOptions.cursorStyle` của xterm nhận — không phải một
 *  danh sách của riêng app, nên nó không được rộng hơn. */
export type CursorStyle = "block" | "underline" | "bar";

/**
 * Cách terminal hiển thị, chung cho mọi tab và nhớ lại giữa các lần mở.
 *
 * Một bộ chứ không phải một bộ mỗi tab, cùng lý do `rest/workspace.ts` giữ bốn công tắc của nó ở
 * một chỗ: cỡ chữ là vì mắt người dùng, và mắt thì không đổi khi họ chuyển tab.
 */
export interface TerminalSettings {
  /** Nguyên một font stack CSS, không phải một tên font: cái này đi thẳng vào `fontFamily` của
   *  xterm, và một máy thiếu font đầu tiên vẫn phải còn đường lui. */
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  /** `LocalShell.name` — `pwsh`, `git-bash`, `wsl:Ubuntu` — chứ không phải đường dẫn. Đường dẫn
   *  của cùng một shell đổi theo bản cài, còn tên thì backend sinh ra ổn định. */
  defaultShell: string | null;
  defaultCwd: string | null;
  /** Chuột phải dán thẳng thay vì mở menu — quy ước của PuTTY, và người quen nó thì rất quen. */
  rightClickPastes: boolean;
  /**
   * Tab mang tên đích đã lưu thay vì `user@host` hoặc tên shell.
   *
   * Ai mở năm tab tới năm máy chủ của cùng một hệ thống thì `deploy@10.0.0.7` không phân biệt được
   * cái nào với cái nào, còn "Prod DB" thì được. Ai chỉ mở một hai phiên thì ngược lại — nên đây là
   * một công tắc chứ không phải một quyết định. Phiên không đến từ đích đã lưu vẫn tên như cũ:
   * không có gì để hiện. Xem `terminalTitle` bên `session.ts`.
   *
   * Bật sẵn: người đã đặt tên cho một đích đã nói tên nào là tên họ đọc ra, và tab thì là chỗ duy
   * nhất cái tên ấy được đọc lại. Tắt nó đi thì công sức đặt tên chỉ còn thấy trong form.
   */
  titleShowsTargetName: boolean;
}

/** Cái xterm đang được dựng bằng từ đợt 1, giữ nguyên làm mặc định. */
export const DEFAULT_FONT_FAMILY = '"Fira Code", monospace';

export const DEFAULT_SCROLLBACK = 5000;

/* Dưới 100 dòng thì cuộn lên không còn nghĩa gì, còn trên 100k thì mỗi phiên giữ vài trăm MB và
   một máy có mười tab terminal là một máy hết bộ nhớ. */
export const MIN_SCROLLBACK = 100;
export const MAX_SCROLLBACK = 100_000;

/** Khoá `localStorage` mà đợt trước cất cỡ chữ vào. Chỉ còn tồn tại để đọc nốt một lần rồi xoá —
 *  xem {@link withLegacyFontSize} và `settingsStore.ts`. */
export const LEGACY_FONT_SIZE_KEY = "mixdb-terminal-font-size";

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  scrollback: DEFAULT_SCROLLBACK,
  cursorStyle: "block",
  cursorBlink: true,
  defaultShell: null,
  defaultCwd: null,
  rightClickPastes: false,
  titleShowsTargetName: true,
};

const CURSOR_STYLES: readonly CursorStyle[] = ["block", "underline", "bar"];

/** Số dòng giữ lại, đã kẹp trong khoảng. Kẹp chứ không từ chối, đúng như `stepFontSize`. */
export function clampScrollback(lines: number): number {
  if (!Number.isFinite(lines)) return DEFAULT_SCROLLBACK;
  return Math.min(MAX_SCROLLBACK, Math.max(MIN_SCROLLBACK, Math.round(lines)));
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Bản ghi đọc từ đĩa thành cài đặt dùng được.
 *
 * Không tin trường nào: `terminal-settings.json` là một file người dùng mở ra sửa được, và bản
 * trước của app viết ra một file thiếu đúng những trường bản này mới thêm. Cả hai ca ra cùng một
 * việc — trường nào hiểu được thì giữ, trường nào không thì lấy mặc định.
 */
export function sanitizeSettings(raw: unknown): TerminalSettings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const cursorStyle = record.cursorStyle;
  return {
    fontFamily: text(record.fontFamily, DEFAULT_FONT_FAMILY),
    // `?? Number.NaN` chứ không để `Number(undefined)` một mình: `Number(null)` ra 0, và 0 kẹp
    // thành cỡ chữ nhỏ nhất thay vì thành mặc định.
    fontSize: stepFontSize(Number(record.fontSize ?? Number.NaN), 0),
    scrollback: clampScrollback(Number(record.scrollback ?? Number.NaN)),
    cursorStyle: CURSOR_STYLES.includes(cursorStyle as CursorStyle)
      ? (cursorStyle as CursorStyle)
      : DEFAULT_SETTINGS.cursorStyle,
    cursorBlink:
      typeof record.cursorBlink === "boolean" ? record.cursorBlink : DEFAULT_SETTINGS.cursorBlink,
    defaultShell: optionalText(record.defaultShell),
    defaultCwd: optionalText(record.defaultCwd),
    rightClickPastes: record.rightClickPastes === true,
    /* `typeof` chứ không phải `=== true`, không như dòng trên: cái này mặc định bật, nên một file
       thiếu nó phải lấy mặc định, còn `false` viết trong file là một câu người dùng đã nói và phải
       sống sót. Cùng hình dạng với `cursorBlink`. */
    titleShowsTargetName:
      typeof record.titleShowsTargetName === "boolean"
        ? record.titleShowsTargetName
        : DEFAULT_SETTINGS.titleShowsTargetName,
  };
}

/**
 * Cài đặt, cộng cỡ chữ mà đợt trước để lại trong `localStorage`.
 *
 * Chỗ cất cỡ chữ đổi từ `localStorage` sang `terminal-settings.json` ở đợt này. Một người đã kéo
 * cỡ chữ lên 20 không có lý do gì để thấy nó về 14 sau khi cập nhật, nên giá trị cũ được đọc nốt
 * đúng một lần — lúc file chưa có cỡ chữ của riêng nó — rồi khoá cũ bị xoá.
 *
 * Hàm thuần, nhận `legacy` như một tham số chứ không tự đọc `localStorage`: `settingsStore.ts`
 * đọc, còn quy tắc thì ở đây, nơi test với tới được mà không cần trình duyệt.
 */
export function withLegacyFontSize(raw: unknown, legacy: string | null): TerminalSettings {
  const settings = sanitizeSettings(raw);
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if (record.fontSize !== undefined && record.fontSize !== null) return settings;
  if (legacy === null) return settings;
  const size = Number(legacy);
  if (!Number.isFinite(size)) return settings;
  return { ...settings, fontSize: stepFontSize(size, 0) };
}

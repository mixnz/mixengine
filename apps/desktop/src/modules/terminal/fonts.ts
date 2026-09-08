import { DEFAULT_FONT_FAMILY } from "./settings";

/**
 * Font đơn cách đáng đưa cho một terminal.
 *
 * Một danh sách viết tay chứ không phải mọi font máy có, và đó là chủ ý: hộp chọn này để chọn font
 * *cho terminal*, mà một terminal cần đúng một thứ — mọi ký tự rộng bằng nhau. Đưa cả nghìn font
 * của máy ra là mời người dùng chọn một font tỷ lệ, và màn hình sẽ lệch cột ngay dòng đầu tiên.
 *
 * `fontProbe.ts` lọc danh sách này xuống còn những cái máy thật sự có.
 */
export const TERMINAL_FONTS: readonly string[] = [
  "Anonymous Pro",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Courier New",
  "Cousine",
  "DejaVu Sans Mono",
  "Fira Code",
  "Fira Mono",
  "Hack",
  "IBM Plex Mono",
  "Inconsolata",
  "Iosevka",
  "JetBrains Mono",
  "Liberation Mono",
  "Lucida Console",
  "Menlo",
  "MesloLGS NF",
  "Monaco",
  "Noto Sans Mono",
  "PT Mono",
  "Roboto Mono",
  "SF Mono",
  "Source Code Pro",
  "Space Mono",
  "Ubuntu Mono",
  "Victor Mono",
];

/**
 * Một tên font thành nguyên font stack để đưa cho xterm.
 *
 * Luôn có `monospace` ở cuối, và đây là chỗ quan trọng nhất của cả file. xterm đo bề rộng một ô
 * chữ bằng `ctx.font = "<cỡ>px <stack>"` trên canvas; một stack rỗng hoặc không phân tích được thì
 * phép gán ấy bị bỏ qua *lặng lẽ* và số đo cũ ở lại, trong khi CSS `font-size` xterm tiêm vào màn
 * hình vẫn đổi. Kết quả là chữ to lên mà ô chữ đứng nguyên, và mọi dòng bị cắt ngang.
 */
export function fontStack(family: string): string {
  const name = family.trim();
  if (name === "") return DEFAULT_FONT_FAMILY;
  return `"${name.replace(/["\\]/g, "")}", monospace`;
}

/** Tên font đứng đầu một stack — đường ngược của {@link fontStack}, để hộp chọn biết đang chọn
 *  cái nào. Một stack không đọc được thì trả về tên của font mặc định, chứ không phải chuỗi rỗng:
 *  hộp chọn phải chỉ vào một mục nào đó. */
export function familyOf(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? "";
  const bare = first.replace(/^["']|["']$/g, "").trim();
  if (bare === "") return familyOf(DEFAULT_FONT_FAMILY);
  return bare;
}

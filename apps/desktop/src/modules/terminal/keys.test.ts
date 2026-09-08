import { describe, expect, it } from "vitest";
import type { Press } from "../../core/shortcuts";
import { shellKeeps } from "./keys";

function press(over: Partial<Press>): Press {
  return { key: "a", shift: false, alt: false, mod: false, ctrlOnly: false, typing: true, ...over };
}

describe("shellKeeps", () => {
  it("hands over a chord the app is listening for", () => {
    expect(shellKeeps(press({ key: "w", mod: true }), true)).toBe(false);
  });

  /* `Ctrl+R` là tìm ngược lịch sử lệnh và `Ctrl+A` là về đầu dòng. Chúng có mặt trong catalogue của
     app, nhưng trong một tab terminal thì không ai nghe — và cái không ai nghe là của shell. */
  it("keeps a chord no handler answers", () => {
    expect(shellKeeps(press({ key: "r", mod: true }), false)).toBe(true);
    expect(shellKeeps(press({ key: "a", mod: true }), false)).toBe(true);
  });

  it("keeps everything typed without the shortcut modifier", () => {
    expect(shellKeeps(press({ key: "c" }), true)).toBe(true);
    expect(shellKeeps(press({ key: "v" }), true)).toBe(true);
  });

  /* `Ctrl+C` là hai lệnh khác nhau tuỳ lúc, và cái quyết định là có vùng chọn hay không — điều
     `terminal.copy` nói bằng cách chỉ đăng ký khi có. Ở đây nó tới dưới dạng `claimed`. */
  it("copies when something is selected and cancels when nothing is", () => {
    expect(shellKeeps(press({ key: "c", mod: true }), true)).toBe(false);
    expect(shellKeeps(press({ key: "c", mod: true }), false)).toBe(true);
  });

  /* Dán không đi qua catalogue: buông tay để webview dán vào textarea của xterm. */
  it("always steps aside for paste", () => {
    expect(shellKeeps(press({ key: "v", mod: true }), false)).toBe(false);
    expect(shellKeeps(press({ key: "v", mod: true, shift: true }), false)).toBe(false);
  });

  /* Trên Mac, `Ctrl+Tab` tới với `mod` tắt vì `mod` ở đó là `⌘`. Không hỏi `ctrlOnly` thì terminal
     giữ luôn phím và tab không bao giờ đổi. */
  it("hands over a Ctrl chord the app claims, even with the primary modifier up", () => {
    expect(shellKeeps(press({ key: "tab", ctrlOnly: true }), true)).toBe(false);
  });

  it("keeps a Ctrl chord nobody claims — Ctrl+V on a Mac is the shell's, not a paste", () => {
    expect(shellKeeps(press({ key: "v", ctrlOnly: true }), false)).toBe(true);
    expect(shellKeeps(press({ key: "r", ctrlOnly: true }), false)).toBe(true);
  });
});

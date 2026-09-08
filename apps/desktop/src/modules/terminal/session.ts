import { shellLabel } from "./shells";
import type { TerminalChoice, TerminalTarget } from "./types";

/** Một dấu tab này nên mang. `TerminalTab` biến nó thành `TabBadge` vì nó là chỗ có `t`. */
export type TerminalBadgeMark = { type: "local" } | { type: "ssh" } | { type: "ended" };

/** Cái người dùng chọn, rút gọn thành cái Rust cần. Nhãn hiển thị ở lại đây. */
export function terminalTarget(choice: TerminalChoice): TerminalTarget {
  if (choice.kind === "local") {
    return { type: "local", shell: choice.shell.path, args: choice.shell.args, cwd: choice.cwd };
  }
  return { type: "ssh", ...choice.config };
}

/**
 * Tên tab: tên shell, hoặc `user@host` — không phải đường dẫn, vì tab bar chỉ rộng vài chữ.
 *
 * `savedName` là tên của đích đã lưu mà phiên này đến từ đó, và nó thắng cả hai khi có. Ai đưa nó
 * xuống đây là việc của người gọi: `TerminalTab` chỉ đưa khi cài đặt *tên tab là tên đích* đang
 * bật và `choice.targetId` tra ra được một entry. Nên hàm này không biết gì về cài đặt ấy, và
 * `null` vẫn là hành vi từ trước tới nay.
 */
export function terminalTitle(choice: TerminalChoice, savedName: string | null): string {
  // Một entry chưa đặt tên là không có gì để hiện, không phải một yêu cầu để tab trống tên.
  if (savedName !== null && savedName.trim() !== "") return savedName;
  return choice.kind === "local"
    ? shellLabel(choice.shell.name)
    : `${choice.config.username}@${choice.config.host}`;
}

/**
 * Tab bar nên hiện dấu gì.
 *
 * Chưa mở phiên thì không dấu nào: form trên màn hình có thể đang chọn một đích khác hẳn cái tab
 * sẽ chạy, đúng như `dbBadgeMarks` không đánh dấu một tab còn đang ở form kết nối.
 */
export function terminalBadgeMarks(
  choice: TerminalChoice | null,
  ended: boolean,
): TerminalBadgeMark[] {
  if (!choice) return [];
  const marks: TerminalBadgeMark[] = [{ type: choice.kind === "local" ? "local" : "ssh" }];
  if (ended) marks.push({ type: "ended" });
  return marks;
}

/**
 * Ô *Chạy khi kết nối* biến thành đúng những phím sẽ được gõ hộ, hoặc `null` khi không có gì.
 *
 * `\r` chứ không phải `\n`, và một cái ở cuối dòng cuối: pty nhận phím Enter, và một lệnh không ai
 * bấm Enter thì nằm đó chờ chứ không chạy. Dòng trống bị bỏ — trong ô nó là khoảng thở, xuống tới
 * shell nó là một lần Enter thừa in thêm một dấu nhắc.
 *
 * Ở đây chứ không ở `TerminalView` vì nó thuần: cùng lý do `terminalTarget` ở đây.
 */
export function openingKeystrokes(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length === 0 ? null : lines.map((line) => `${line}\r`).join("");
}

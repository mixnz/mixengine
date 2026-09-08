import { Channel, invoke } from "@tauri-apps/api/core";
import type { LocalShell, TerminalSize, TerminalTarget } from "./types";

/**
 * Chỗ duy nhất trong module này nói chuyện với native.
 *
 * Mọi lệnh reject bằng `AppError` — `{ code, params }` — và người gọi đưa qua `errorMessage(t, e)`
 * chứ không hiện thẳng.
 */

/** Máy này mở được shell nào; thứ tự là thứ tự gợi ý, cái đầu tiên là mặc định. */
export function localShells(): Promise<LocalShell[]> {
  return invoke<LocalShell[]>("terminal_local_shells");
}

/** Phiên kết thúc: shell thoát bình thường, hoặc đường đứt. Đợt 1 `message` luôn null. */
export interface SessionExit {
  type: "exit";
  code: number | null;
  message: string | null;
}

/** Một kênh chở hai thứ: `ArrayBuffer` là byte đầu xa in ra, object là phiên đã kết thúc. Cùng
 *  một kênh nên thứ tự là thật — `exit` không thể tới trước byte cuối cùng. */
export type SessionMessage = ArrayBuffer | SessionExit;

export function openSession(
  id: string,
  target: TerminalTarget,
  size: TerminalSize,
  onEvent: (message: SessionMessage) => void,
): Promise<void> {
  const channel = new Channel<SessionMessage>();
  channel.onmessage = onEvent;
  return invoke("terminal_open", { id, target, size, onEvent: channel });
}

export function writeSession(id: string, data: string): Promise<void> {
  return invoke("terminal_write", { id, data });
}

export function resizeSession(id: string, cols: number, rows: number): Promise<void> {
  return invoke("terminal_resize", { id, cols, rows });
}

export function closeSession(id: string): Promise<void> {
  return invoke("terminal_close", { id });
}

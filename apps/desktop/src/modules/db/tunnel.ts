import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError } from "../../core/errors";

/**
 * Chuyện đang xảy ra với SSH tunnel của một connection.
 *
 * Chỉ connection nào đi qua tunnel mới có sự kiện này — connection nối thẳng không phát gì cả, nên
 * không cần một cờ riêng để biết có nên vẽ banner hay không.
 */
export interface TunnelState {
  /** Connection này là của tab nào: hai tab có thể cùng đứt một lúc và mỗi tab chỉ nghe của mình. */
  id: string;
  state: "reconnecting" | "reconnected" | "failed";
  /** Chỉ có với `failed`: vì sao không mở lại được — khoá sai, host không tới được. */
  error?: AppError;
}

/** Nghe mọi tin về tunnel của `id` cho tới khi hàm trả về được gọi. */
export function onTunnelState(
  id: string,
  onState: (state: TunnelState) => void
): Promise<UnlistenFn> {
  return listen<TunnelState>("tunnel://state", ({ payload }) => {
    if (payload.id === id) onState(payload);
  });
}

/** Mở lại phiên SSH ngay, thay vì chờ hết nhịp backoff của watcher bên Rust. */
export function tunnelReconnect(id: string): Promise<void> {
  return invoke("tunnel_reconnect", { id });
}

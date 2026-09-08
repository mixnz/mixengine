import { readText as readSystemClipboard } from "@tauri-apps/plugin-clipboard-manager";
import type { AppError } from "../../core/errors";

/**
 * Lấy văn bản trên clipboard xuống.
 *
 * Ở đây chứ không ở `core/clipboard.ts` cạnh `copyText`, và ranh giới mới là lý do: `core/` không
 * gọi Tauri, còn cách đọc clipboard duy nhất dùng được thì phải đi qua Rust.
 *
 * Vì `navigator.clipboard.readText()` không dùng được: WebView2 coi việc *đọc* clipboard là một
 * quyền phải xin, nên lần đầu bấm Dán trong menu là một dải hệ thống dựng lên giữa cửa sổ hỏi
 * "trang này muốn xem những gì bạn đã sao chép" — app không tô vẽ được nó, và câu trả lời được nhớ
 * theo origin nên nó chỉ hiện đúng một lần, đủ để không ai gặp lại mà sửa. Ghi thì không bị hỏi,
 * nên `copyText` ở lại `core/` với đường `execCommand` dự phòng của nó.
 *
 * Chỉ menu chuột phải đi qua đây. `Ctrl+V` không: `shellKeeps` buông phím ra cho webview và xterm
 * nghe sự kiện `paste` của chính nó — một phím dán thì không phải xin phép ai cả.
 */
export async function readText(): Promise<string> {
  try {
    return await readSystemClipboard();
  } catch (e) {
    const error: AppError = { code: "error.terminalClipboardRead", params: { message: String(e) } };
    throw error;
  }
}

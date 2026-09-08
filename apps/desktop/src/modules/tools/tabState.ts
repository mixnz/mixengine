/**
 * Cái một tab Tools nhớ giữa hai lần chạy app: tool nào đang mở.
 *
 * Id và chỉ id. Nội dung hai ô vào/ra không bao giờ đi qua đây — đây là `localStorage`, và người
 * ta dán token với chuỗi kết nối có mật khẩu vào các tool này suốt.
 */
export interface ToolsTabState {
  toolId: string;
}

/**
 * Giá trị đã lưu, nếu nó là một, hoặc `null`.
 *
 * Kiểm shape và chỉ shape. Việc `toolId` còn nằm trong registry hay không là câu hỏi của
 * `ToolsTab` lúc mount: một tool bị gỡ giữa hai lần chạy app không phải lỗi để báo.
 */
export function parseToolsTabState(value: unknown): ToolsTabState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.toolId !== "string" || state.toolId === "") return null;
  return { toolId: state.toolId };
}

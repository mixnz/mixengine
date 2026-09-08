/**
 * Cầu nối một chiều từ Projects sang Sites: "mở Sites, lọc sẵn theo project X".
 *
 * Sites tự giữ `projectFilter` cục bộ, không đọc từ URL hay từ tab state — nên không có chỗ nào để
 * Projects đặt giá trị đó thẳng vào ngoài việc chờ Sites tự đọc lúc nó `active`. Module này là đúng
 * một biến ở giữa, cùng khuôn `daemonWatch.ts` (module-level state, không phải React context) vì
 * chỉ có một Sites tồn tại trong tab MixEngine tại một thời điểm.
 *
 * **`take` chứ không phải `peek`** — đọc một lần rồi xoá, để lần sau người dùng tự đổi filter tay
 * không bị ghi đè lại bởi một yêu cầu điều hướng đã cũ.
 */
let pendingProjectFilter: string | null = null;

export function requestSitesFilter(project: string): void {
  pendingProjectFilter = project;
}

export function takePendingSitesFilter(): string | null {
  const project = pendingProjectFilter;
  pendingProjectFilter = null;
  return project;
}

import { createStore, jsonFile, useStore } from "../../core/jsonStore";

/**
 * Những lựa chọn của module Tools còn lại giữa các phiên.
 *
 * Chỉ là đồ đạc, không phải dữ liệu: múi giờ một người làm việc trong đó là như nhau ở mọi tab, và
 * chọn lại nó mỗi lần mở app là việc vô nghĩa. **Nội dung hai ô vào/ra vẫn không bao giờ được lưu**
 * — người ta dán token và chuỗi kết nối có mật khẩu vào các tool này.
 */
export interface ToolsWorkspace {
  /** Tên hiện hành của IANA — xem `tools/timestamp/zones.ts`. `null` nghĩa là dùng múi của máy. */
  timeZone: string | null;
}

const DEFAULTS: ToolsWorkspace = { timeZone: null };

/* Trải lên trên phần mặc định chứ không thay thế nó: một file do bản cũ ghi ra vẫn là lựa chọn của
   người dùng, và trường nó chưa từng nghe tới thì lấy giá trị mặc định. */
const file = jsonFile<Partial<ToolsWorkspace>>("tools-workspace.json", "workspace", {});
const store = createStore<ToolsWorkspace>({
  defaults: DEFAULTS,
  load: async () => ({ ...DEFAULTS, ...(await file.load()) }),
  persist: file.persist,
});

/** Ghi ngầm phía sau. Không có gì ở đây đáng một thông báo lỗi trước mặt người dùng: một múi giờ
 *  không kịp xuống đĩa là một múi giờ trở về mặc định ở lần mở sau. */
function write(next: ToolsWorkspace): void {
  void store.save(next).catch(() => {});
}

export function useToolsWorkspace(): ToolsWorkspace {
  return useStore(store);
}

export function setTimeZone(timeZone: string | null): void {
  write({ ...store.get(), timeZone });
}

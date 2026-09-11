import type { SiteSummary } from "@mixengine/api";

/**
 * Dashboard có mời người dùng dựng site đầu tiên không — T117.
 *
 * **Là trạng thái của home, không phải một cờ đã lưu.** Một cờ "đã bỏ qua" là thứ phải lưu, phải
 * migrate, và sẽ có người sửa tay sai; đọc từ `site.list` thì một máy vừa xoá hết site sẽ thấy thẻ
 * mời quay lại — đúng, và không có gì để reset.
 *
 * `null` nghĩa là **danh sách chưa về**, không phải home rỗng: mời trên `null` sẽ làm thẻ loé lên
 * trước mặt cả người đã có hai mươi site, mỗi lần mở tab.
 *
 * **Project không tính.** Người có ba project và không site nào thì vẫn chưa có website — đó chính
 * là câu phàn nàn mà T117 được viết ra để trả lời.
 */
export function shouldOfferQuickStart(sites: SiteSummary[] | null): boolean {
  return sites !== null && sites.length === 0;
}

/**
 * Tên project gõ vào đã dùng được chưa.
 *
 * Không phải bản sao luật slug của daemon — daemon vẫn là chỗ từ chối, và thẻ này không được đoán
 * thay nó. Đây chỉ là điều kiện để **bật nút**: rỗng thì không có gì để gửi.
 */
export function canStart(project: string, root: string): boolean {
  return project.trim() !== "" && root.trim() !== "";
}

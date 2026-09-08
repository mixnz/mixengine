import type { ServiceId } from "../../api/types/ServiceId";

/**
 * Dựng `ServiceId` từ package người dùng chọn và cái tên instance họ gõ thêm.
 *
 * **Không có ô nhập id.** `ServiceId` tự tài liệu hoá phần trước `@` là "the package this is an
 * instance of" (xem doc của type), nên để người dùng gõ cả chuỗi là mời họ gõ ra một id mà phần
 * đầu không khớp package nào — daemon từ chối, và câu từ chối đó không nói được là họ gõ nhầm chỗ
 * nào. Package tới từ một `Select`, chỉ phần sau `@` là chữ tự do.
 *
 * Instance rỗng ra tên package trần (`caddy`), đúng hình `service.list` đang trả về cho instance
 * đầu tiên của một package. Không tự đặt hộ một tên như `@main`: đó là một quyết định, và
 * `ServiceId` là thứ đi vào tên thư mục `logs/services/<id>/` nên đổi về sau không rẻ.
 */
export function serviceIdFrom(packageName: string, instance: string): ServiceId {
  const suffix = instance.trim();
  return suffix === "" ? packageName : `${packageName}@${suffix}`;
}

/**
 * Một home chỉ có đúng một front end, nên id của nó không mang `@`.
 *
 * **Đây là bản sao của một luật nằm bên daemon, và MixDB không tra được nó.** `package.list` không
 * có field nào nói package này cho phép mấy instance (xem `PackageSummary`, `PackageRelease`) —
 * luật nằm trong recipe. Daemon nói câu cuối cùng: `service.create` với `caddy@main` bị từ chối
 * `invalid_argument` kèm "there is one caddy, so its id carries no `@`", và một package MixEngine
 * thêm sau này mà bảng dưới chưa biết vẫn bị nó chặn đúng như vậy.
 *
 * Nên bảng dưới **chỉ chọn hộ giá trị mặc định của một ô nhập**, không phải chỗ quyết định đúng
 * sai. Đoán sai theo chiều nào cũng chỉ tốn một câu từ chối đọc được, không phải một service hỏng.
 *
 * `true` cho tên lạ: phần lớn package còn lại là database và cache, và một package mới mà form
 * lặng lẽ giấu mất ô tên instance là một package không dựng được instance thứ hai từ MixDB.
 */
export function takesInstanceName(packageName: string): boolean {
  return !FRONT_ENDS.has(packageName.toLowerCase());
}

const FRONT_ENDS = new Set(["caddy", "nginx", "apache", "apache2", "httpd"]);

/** Tên gợi ý cho instance đầu tiên — chính cái `mariadb@main` doc của `ServiceId` lấy làm ví dụ. */
export const DEFAULT_INSTANCE = "main";

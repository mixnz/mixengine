import type { SiteOwner } from "./api/types/SiteOwner";
import type { SiteSummary } from "./api/types/SiteSummary";

export type SiteRow = SiteSummary;

/**
 * Chỉ site thuộc một project mới sửa được.
 *
 * Site của một extension chỉ xem/liệt kê được ở đây — `site.update` gửi thẳng vào nó vẫn bị daemon
 * từ chối dù UI có cho phép, nhưng để nút bấm luôn hỏng là hứa một hành động không giữ được.
 */
export function canEditSite(owner: SiteOwner): boolean {
  return owner.type === "project";
}

/**
 * Áp `site_sharing_changed` lên bảng site.
 *
 * Cùng luật Dashboard đã theo cho `service_state_changed`: sự kiện là best-effort, nhưng khi tới nó
 * là nguồn thật, không phải suy đoán. `type` lạ hoặc payload hỏng bị bỏ qua, không ném — một biến
 * thể sinh ra ở phiên bản sau phải tới được một MixDB cũ như một object bỏ qua được.
 */
export function applySharingChange(rows: SiteRow[], raw: string): SiteRow[] {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return rows;
  }
  if (
    typeof event !== "object" ||
    event === null ||
    (event as { type?: unknown }).type !== "site_sharing_changed"
  ) {
    return rows;
  }
  const { domain, sharing } = event as { domain: string; sharing: SiteRow["sharing"] };
  return rows.map((row) => (row.domain === domain ? { ...row, sharing } : row));
}

/** Tên hiển thị mỗi domain gõ vào, tách bằng dấu phẩy hoặc xuống dòng — đầu danh sách là chính.
 *  Dùng chung giữa `SiteForm` và khối "tạo nhanh site" trong `ProjectForm`. */
export function parseDomains(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((d) => d.trim())
    .filter((d) => d !== "");
}

/**
 * Phần còn lại của một đường dẫn tuyệt đối sau khi bỏ project root — dùng ngay sau khi dialog chọn
 * thư mục (luôn trả tuyệt đối) trả về, để field Doc root chỉ giữ đúng phần daemon thật sự lưu
 * (`SiteSummary.doc_root`: "Relative to the project's root, as stored"). Không nằm dưới root thì
 * giữ nguyên tuyệt đối — `SiteCreate.doc_root` chấp nhận cả hai, đây là trường hợp hiếm không đáng
 * chặn.
 */
export function relativeToRoot(root: string, absolute: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (absolute === normalizedRoot) return "";
  for (const separator of ["/", "\\"]) {
    const prefix = `${normalizedRoot}${separator}`;
    if (absolute.startsWith(prefix)) return absolute.slice(prefix.length);
  }
  return absolute;
}

/** Nối root với phần còn lại để hiển thị — chỉ để đọc, không phải giá trị gửi lên daemon (đó vẫn
 *  là phần còn lại một mình). `""` là chính root, đúng nghĩa `SiteSummary.doc_root` ghi. */
export function joinDocRoot(root: string, relative: string): string {
  if (relative === "") return root;
  const base = root.replace(/[\\/]+$/, "");
  return `${base}/${relative}`;
}

/** `mm:ss`, hay `hh:mm:ss` một khi còn hơn một giờ. Quá hạn kẹp về 0, không âm. */
export function formatRemaining(untilMs: number, nowMs: number = Date.now()): string {
  const totalSeconds = Math.max(0, Math.round((untilMs - nowMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

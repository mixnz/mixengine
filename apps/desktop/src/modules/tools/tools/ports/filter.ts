import type { ListeningPort } from "./api";

/**
 * Một hàng có khớp ô lọc không.
 *
 * Khớp theo **số cổng hoặc tên tiến trình**: nửa thời gian câu hỏi là "cái gì đang giữ 3000", nửa
 * còn lại là "mấy con node đang chạy ở đâu", và một ô lọc trả lời được cả hai thì không phải chọn.
 *
 * Tên tiến trình so không phân biệt hoa thường — người ta gõ `node`, không gõ `Node.exe`. Số cổng
 * thì so theo chuỗi con, nên gõ `80` ra cả `80`, `8080` và `3080`; đó là thứ có ích khi chưa nhớ
 * chính xác cổng.
 */
export function matchesFilter(row: ListeningPort, needle: string): boolean {
  const text = needle.trim().toLowerCase();
  if (text === "") return true;
  if (String(row.port).includes(text)) return true;
  return row.process !== null && row.process.toLowerCase().includes(text);
}

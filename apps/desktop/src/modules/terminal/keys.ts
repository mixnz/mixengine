import type { Press } from "../../core/shortcuts";

/**
 * Phím này thuộc về shell hay thuộc về app.
 *
 * Một terminal khác mọi khung khác của app ở chỗ mặc định của nó là *nhường*: `Ctrl+A` là về đầu
 * dòng, `Ctrl+R` là tìm ngược lịch sử lệnh, `Ctrl+D` là hết đầu vào. Nên câu hỏi không phải "app có
 * dùng phím này không" mà là "app có ai đang thật sự nghe phím này không" — và danh sách ấy do
 * `isClaimed` trả lời, đọc đúng cái catalogue mà bộ điều phối đọc.
 *
 * Hàm thuần, không DOM, không xterm: quy tắc thì đáng test còn chỗ nối vào xterm thì không.
 */
export function shellKeeps(press: Press, claimed: boolean): boolean {
  /* Dán là ngoại lệ duy nhất không hỏi catalogue. Không có handler nào cả — buông tay ra là webview
     tự dán vào textarea của xterm, và xterm vốn đã nghe sự kiện `paste` ở đó. Bắt lấy rồi tự đọc
     clipboard chỉ là viết lại một thứ đang chạy sẵn, bằng một API mà webview có quyền từ chối.

     Buộc vào `mod` chứ không vào `ctrlOnly`: trên Mac, dán là `⌘V` còn `Ctrl+V` là chèn nguyên ký
     tự điều khiển của readline — hai phím khác nhau, và cái sau là của shell. */
  if (press.mod && press.key === "v") return false;
  /* Không giữ phím tắt thì không có gì để tranh: gõ là gõ. Hỏi cả `ctrlOnly` vì có chord chạy bằng
     `Ctrl` trên mọi nền tảng — `Ctrl+Tab` — nên trên Mac `mod` một mình sẽ bỏ sót nó. */
  if (!press.mod && !press.ctrlOnly) return true;
  return !claimed;
}

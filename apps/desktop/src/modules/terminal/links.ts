/**
 * Cái gì trong màn hình terminal được phép mở ra ngoài, và cái gì không.
 *
 * Mọi chuỗi đi qua đây đều do một máy chủ in ra. Trao nó cho trình mở của hệ điều hành là trao cho
 * máy chủ ấy một đường khởi động thứ gì đó trên máy này, nên chỉ hai lược đồ đi qua: `http` và
 * `https`. `file:`, `data:` và mọi lược đồ do ứng dụng cài đặt tự đăng ký — `vscode:`, `ms-msdt:` —
 * đều dừng ở đây, dù regex của addon có nhặt chúng lên hay không.
 */

/** Địa chỉ như nó được viết, nếu mở được; `null` với mọi thứ khác. */
export function openableUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  // `URL` đã hạ lược đồ về chữ thường rồi; cái trả về là chuỗi gốc, vì đó là cái người dùng thấy.
  return url.protocol === "http:" || url.protocol === "https:" ? text : null;
}

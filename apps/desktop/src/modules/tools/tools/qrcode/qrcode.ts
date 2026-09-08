/**
 * Bọc `qrcode-generator` (thư viện tham chiếu gốc, 0 dependency) thành một hàm thuần: text vào,
 * grid ra. Panel tự vẽ canvas từ grid — không dùng `createDataURL` có sẵn của lib, để tự do đổi
 * màu/kiểu module.
 */
import qrcodeGenerator from "qrcode-generator";

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrGrid {
  size: number;
  isDark: (row: number, col: number) => boolean;
}

/** `typeNumber = 0` để lib tự chọn version QR nhỏ nhất chứa vừa `text`.
 *  Text vượt cả version 40 (lớn nhất) thì `make()` ném lỗi — bắt lại và trả `null` thay vì để
 *  Panel crash, giống cách `radix`/`diff` báo "không đọc được" thay vì ném exception ra ngoài. */
export function encodeQr(text: string, level: ErrorCorrectionLevel): QrGrid | null {
  const qr = qrcodeGenerator(0, level);
  qr.addData(text);
  try {
    qr.make();
  } catch {
    return null;
  }
  return { size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

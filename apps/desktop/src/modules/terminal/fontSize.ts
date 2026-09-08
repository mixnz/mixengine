/**
 * Cỡ chữ của màn hình terminal.
 *
 * Mặc định to hơn hẳn cỡ mặc định của xterm, vì đây là chỗ người ta ngồi đọc log hàng phút liền
 * chứ không phải một nhãn trên nút.
 */
export const DEFAULT_FONT_SIZE = 16;

/* Hai đầu của khoảng, và cả hai đều là giới hạn thật chứ không phải con số cho đẹp: dưới 8 thì
   chữ hết đọc được, còn trên 32 thì một cửa sổ bình thường chỉ còn khoảng 40 cột — hẹp hơn cả cái
   `git log` giả định. */
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;

/**
 * Một nấc to lên hay nhỏ đi, đã kẹp trong khoảng.
 *
 * Kẹp chứ không từ chối: người dùng giữ `Ctrl+-` là đang nói "nhỏ nữa", và câu trả lời đúng khi
 * đã chạm đáy là ở nguyên đó, không phải là một lỗi.
 */
export function stepFontSize(current: number, delta: number): number {
  const from = Number.isFinite(current) ? Math.round(current) : DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, from + delta));
}

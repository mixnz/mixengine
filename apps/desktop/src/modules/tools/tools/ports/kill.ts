/**
 * Lệnh giết một tiến trình, in ra để chép.
 *
 * **Tool không chạy lệnh nào trong đây.** Đó là ranh giới an toàn của cả module: một tool in ra
 * `kill -9` là một tool người dùng đọc trước khi chạy, còn một nút "Kill" là một cú bấm nhầm.
 */

export type KillOs = "macos" | "linux" | "windows";

export function killByPid(os: KillOs, pid: number): string {
  return os === "windows" ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`;
}

export function killByPort(os: KillOs, port: number): string {
  if (os === "windows") {
    // `%a` chứ không phải `%%a`: chuỗi này được dán thẳng vào dấu nhắc cmd, không vào một file .bat.
    return `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /PID %a /F`;
  }
  return `lsof -ti:${port} | xargs kill -9`;
}

/**
 * Máy đang chạy MixDB là OS nào — chỉ để đặt **giá trị mặc định** của ô chọn.
 *
 * Ô vẫn đổi tay được, và đó là chủ ý: người ngồi Windows thường xuyên cần lệnh kill cho một server
 * Linux đang mở ở tab Terminal bên cạnh.
 */
export function hostOs(): KillOs {
  const platform = navigator.platform.toLowerCase();
  if (platform.startsWith("win")) return "windows";
  if (platform.startsWith("mac")) return "macos";
  return "linux";
}

/** Tiền tố Rust dùng cho một bản phân phối WSL: `wsl:Ubuntu`. */
const WSL_PREFIX = "wsl:";

/** Tên riêng, nên không dịch — cái được dịch là nhãn của ô chọn, không phải nội dung của nó. */
const LABELS: Record<string, string> = {
  powershell: "Windows PowerShell",
  pwsh: "PowerShell 7",
  cmd: "Command Prompt",
  "git-bash": "Git Bash",
};

/** Nhãn hiển thị cho một shell dò được. Tên lạ trả về chính nó: bảng này là chỗ làm đẹp, không
 *  phải chỗ lọc. */
export function shellLabel(name: string): string {
  if (name.startsWith(WSL_PREFIX)) return `WSL: ${name.slice(WSL_PREFIX.length)}`;
  return LABELS[name] ?? name;
}

/** Thương hiệu vẽ được cho một shell — xem `icons.tsx`. */
export type ShellBrand = "powershell" | "git" | "bash" | "zsh" | "fish" | "linux";

/**
 * Logo nào đứng trước tên một shell, hay không có logo nào.
 *
 * Tách khỏi `icons.tsx` vì đây là phần đáng test: cái file kia chỉ là dữ liệu đường vẽ. `null` là
 * một câu trả lời thật chứ không phải một thiếu sót — `cmd` và `sh` không có logo nào, và một
 * biểu tượng terminal chung là câu đúng cho chúng.
 */
export function shellBrand(name: string): ShellBrand | null {
  // Mọi bản phân phối đều là Linux; chim cánh cụt nói đúng điều duy nhất chắc chắn đúng ở đây.
  if (name.startsWith(WSL_PREFIX)) return "linux";
  switch (name) {
    case "powershell":
    case "pwsh":
      return "powershell";
    // Git Bash là bash, nhưng cái phân biệt nó với bash của WSL hay của macOS là Git.
    case "git-bash":
      return "git";
    case "bash":
      return "bash";
    case "zsh":
      return "zsh";
    case "fish":
      return "fish";
    default:
      return null;
  }
}

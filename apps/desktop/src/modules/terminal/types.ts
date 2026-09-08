/** Một shell dò được trên máy này. `name` là định danh bền — `shells.ts` biến nó thành nhãn. */
export interface LocalShell {
  /** `powershell`, `pwsh`, `cmd`, `git-bash`, `wsl:<distro>`, `zsh`, `bash`, `sh`. */
  name: string;
  path: string;
  /** Tham số cố định của shell đó; rỗng với hầu hết, `["-d", "<distro>"]` với WSL. */
  args: string[];
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/* Máy chủ SSH là của `core/ssh.ts`, không phải của module này: bên Rust chỉ có một `SshConfig`
   dùng chung cho tunnel của db và cho phiên terminal, và đây từng là một trong hai bản sao của nó.
   Xuất lại chứ không bắt mọi chỗ đổi import. */
import type { SshConfig } from "../../core/ssh";
export type { SshAuth, SshConfig } from "../../core/ssh";

/**
 * Một đích người dùng đã lưu lại: một shell trên máy này, hoặc một máy chủ SSH.
 *
 * Cột bên trái `TargetForm` là danh sách này, và nó cố ý trộn chung hai loại: nó là *những chỗ tôi
 * hay mở*, không phải danh sách máy chủ — nên nó vẫn hiện khi form đang ở "Máy này", đúng như nó
 * vẫn hiện từ trước.
 *
 * Entry ghi bởi bản cũ không có `kind`. `parseSavedTarget` đọc chúng là `ssh`, vì hồi ấy không có
 * loại nào khác — không có bước chuyển đổi nào, và file chỉ đổi hình khi người dùng lưu lại.
 */
export type SavedTarget = SavedLocalTarget | SavedSshTarget;

interface SavedTargetBase {
  id: string;
  name: string;
  /**
   * Lệnh gõ hộ ngay khi shell lên tiếng — `cd ~/project-a/frontend`, `nvm use`, mấy dòng đầu tiên
   * vẫn phải gõ lại mỗi lần vào. Mỗi dòng là một lệnh; `openingKeystrokes` bên `session.ts` biến ô
   * này thành phím.
   *
   * Rust không bao giờ thấy nó: nó đi xuống pty như phím người dùng bấm. Và nó nằm nguyên văn
   * trong `terminal-hosts.json`, nên nó không phải chỗ để mật khẩu; xem đầu `savedTargets.ts`.
   */
  runOnConnect?: string;
}

/** Một shell trên máy này. `shellName` chứ không phải đường dẫn — `powershell`, `wsl:Ubuntu`: tên
 *  là định danh bền, còn đường dẫn thì đổi theo máy, đúng như `TerminalTabState` đã quyết. */
export interface SavedLocalTarget extends SavedTargetBase {
  kind: "local";
  shellName: string;
  cwd: string | null;
}

/** Một máy chủ SSH. `config` ở đây luôn đầy đủ — `savedTargets.ts` ghép phần bí mật từ kho thông
 *  tin đăng nhập vào trước khi trao nó cho ai. */
export interface SavedSshTarget extends SavedTargetBase {
  kind: "ssh";
  config: SshConfig;
}

/** Đích của một phiên, đúng hình dạng `TerminalTarget` bên Rust. Nhánh `ssh` trải phẳng bốn trường
 *  của `SshConfig` vì bên Rust nó là một nhánh newtype trong enum có `tag`. */
export type TerminalTarget =
  | { type: "local"; shell: string; args: string[]; cwd: string | null }
  | ({ type: "ssh" } & SshConfig);

/**
 * Cái người dùng chọn trong form. Rộng hơn `TerminalTarget`: giữ cả `LocalShell` để đặt tên tab,
 * `targetId` để biết phiên này đến từ đích đã lưu nào, và `runOnConnect` để gõ hộ mấy dòng đầu —
 * ba thứ Rust không cần biết.
 */
export type TerminalChoice =
  | {
      kind: "local";
      shell: LocalShell;
      cwd: string | null;
      targetId: string | null;
      runOnConnect: string | null;
    }
  | {
      kind: "ssh";
      config: SshConfig;
      targetId: string | null;
      runOnConnect: string | null;
    };

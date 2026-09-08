use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Kích thước khung, tính bằng ô chữ.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

/// Một shell dò được trên máy này.
#[derive(Debug, Clone, Serialize)]
pub struct LocalShell {
    /// Định danh bền — `shells.ts` biến nó thành nhãn hiển thị.
    pub name: String,
    pub path: String,
    /// Tham số cố định; rỗng với hầu hết, `["-d", "<distro>"]` với WSL.
    pub args: Vec<String>,
}

/// Phiên mở đi đâu.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TerminalTarget {
    Local {
        /// `None` là "shell mặc định của máy".
        shell: Option<String>,
        #[serde(default)]
        args: Vec<String>,
        cwd: Option<String>,
    },
    /// Máy chủ mở phiên. Đúng `SshConfig` mà tunnel dùng — bốn trường ấy là bốn trường của một máy
    /// chủ SSH, không của thứ nằm ở đầu kia.
    Ssh(crate::ssh::SshConfig),
}

/// Thứ duy nhất phiên gửi ngược lên UI dưới dạng JSON. Byte thì đi thẳng, không bọc.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TerminalEvent {
    Exit {
        code: Option<i32>,
        message: Option<String>,
    },
}

/// Đầu xa nói gì. `commands.rs` là chỗ duy nhất biến cái này thành khung IPC — nhờ vậy cả lớp
/// phiên chạy được trong `cargo test` mà không cần webview.
#[derive(Debug, Clone)]
pub enum Output {
    Data(Vec<u8>),
    Exit {
        code: Option<i32>,
        message: Option<String>,
    },
}

pub type OutputSink = Arc<dyn Fn(Output) + Send + Sync>;

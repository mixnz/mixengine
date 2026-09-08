//! Daemon có ở đó không, và nếu không thì khởi động nó.
//!
//! **Ba trạng thái, không phải hai**, và UI vẽ ba thứ khác nhau: *không chạy* (không dial được
//! nhưng `mixengined` có trên máy), *không trả lời* (dial được, `/health` không xong), *không có
//! MixEngine* (không tìm thấy chương trình). Gộp cả ba thành "lỗi" là bắt người dùng đoán xem họ
//! phải cài, phải khởi động, hay phải chờ.
//!
//! `/health` không cần xác thực — đó chính là lý do nó tồn tại bên MixEngine: để một client quyết
//! định có tự khởi động daemon không.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

use crate::error::AppError;

use super::rpc;

/// Tên trần của daemon, để `PATH` phân giải.
const DAEMON: &str = "mixengined";

/// Những chỗ MixEngine được cài vào, ngoài `PATH`.
///
/// **`PATH` một mình là không đủ, và đây là chuyện đo được chứ không phải phòng xa.** Trên máy
/// dựng module này MixEngine nằm ở `%LOCALAPPDATA%\Programs\MixEngine\mixengined.exe` và
/// **không** có trên `PATH`: installer Windows là bản per-user và sửa `PATH` của người dùng, còn
/// một tiến trình đang chạy — hay một app GUI Explorer khởi động — mang theo `PATH` nó thừa kế lúc
/// mở. Chỉ hỏi `PATH` là trả lời "chưa cài MixEngine" cho một máy đã cài, và đẩy người dùng đi tải
/// lại thứ họ đang có.
///
/// macOS và Linux không cần danh sách này — `.pkg`, `.deb` và `.rpm` đặt vào `/usr/local/bin` hoặc
/// `/usr/bin`, vốn đã trên `PATH` — nhưng hai đường đó rẻ và không sai ở đâu cả.
fn well_known() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(|base| vec![PathBuf::from(base).join(r"Programs\MixEngine\mixengined.exe")])
            .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        vec![
            PathBuf::from("/usr/local/bin/mixengined"),
            PathBuf::from("/usr/bin/mixengined"),
        ]
    }
}

/// Chương trình để khởi động một daemon: đường cài đã biết nếu có, không thì tên trần cho `PATH`.
fn program() -> OsString {
    well_known()
        .into_iter()
        .find(|path| path.is_file())
        .map(OsString::from)
        .unwrap_or_else(|| DAEMON.into())
}

/// Daemon đang ở trạng thái nào, nhìn từ đây.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Presence {
    Running,
    NotAnswering,
    NotRunning,
    NotInstalled,
}

/// Bao lâu thì coi như daemon không trả lời.
///
/// `/health` là một lần đọc không chạm đĩa ở đầu kia; hai giây là rộng rãi tới mức chỉ một daemon
/// thật sự kẹt mới chạm phải, và đủ ngắn để cổng vào tab không đứng hình.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);

/// Daemon đang ở trạng thái nào.
///
/// **Đúng một lần dial.** Bản trước dial một lần chỉ để hỏi "có ai ở đó không", vứt kết nối đi, rồi
/// dial lại cho `/health` — và trên Windows lần dial phí ấy ăn mất đúng cái instance pipe đang chờ,
/// nên lần thứ hai gặp một daemon chưa kịp dựng cái thay thế. Kết quả là "daemon không trả lời" ở
/// một máy daemon đang chạy bình thường. Câu hỏi "có ai ở đó không" đã nằm sẵn trong câu trả lời
/// của `/health`, nên hỏi riêng nó không thêm gì ngoài một lỗi.
pub async fn presence() -> Presence {
    match tokio::time::timeout(HEALTH_TIMEOUT, rpc::request("GET", "/health", None)).await {
        Ok(Ok(_)) => Presence::Running,
        // Không tới được endpoint: chưa chạy, hoặc chưa cài. Đó là hai câu khác nhau.
        Ok(Err(error)) if error.code == "error.mixengineUnreachable" => {
            if installed().await {
                Presence::NotRunning
            } else {
                Presence::NotInstalled
            }
        }
        // Tới được nhưng không xong: một daemon đang kẹt, hoặc một pipe của tài khoản khác.
        _ => Presence::NotAnswering,
    }
}

/// `mixengined` có trên máy này không. Chỉ hỏi khi đã biết không dial được.
///
/// Một lần đọc đĩa trước, vì nó không tốn tiến trình nào; chỉ khi không thấy mới thử `PATH`.
async fn installed() -> bool {
    if well_known().iter().any(|path| path.is_file()) {
        return true;
    }
    tauri::async_runtime::spawn_blocking(|| {
        let mut command = Command::new(DAEMON);
        command.arg("--version");
        // Mã thoát không quan trọng: câu hỏi là chương trình có chạy được không, và một phiên bản
        // không hiểu `--version` vẫn là một MixEngine đã cài.
        crate::platform::hide_console(&mut command).output().is_ok()
    })
    .await
    .unwrap_or(false)
}

/// Khởi động daemon và trả về endpoint nó in ra.
///
/// `--detach` **chỉ trả về khi daemon đã trả lời trên endpoint của nó** và in endpoint ra stdout —
/// nên không có vòng lặp backoff ở đây. Việc chờ thuộc về tiến trình biết con nó còn sống hay
/// không, và đó không phải tiến trình này.
pub async fn start_daemon() -> Result<String, AppError> {
    let output = tauri::async_runtime::spawn_blocking(|| {
        let mut command = Command::new(program());
        command.arg("--detach");
        crate::platform::hide_console(&mut command).output()
    })
    .await
    .map_err(|e| err!("error.mixengineStartFailed", message = e))?
    .map_err(|e| err!("error.mixengineStartFailed", message = e))?;

    if !output.status.success() {
        return Err(err!(
            "error.mixengineStartFailed",
            message = String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Có tìm ra một chương trình để chạy: đường cài đã biết, hoặc tên trần cho `PATH`.
    #[test]
    fn there_is_always_a_program_to_try() {
        assert!(!program().is_empty());
    }

    /// Trên Windows, danh sách phải nêu đúng chỗ installer per-user đặt daemon vào — đó là chỗ
    /// `PATH` không nêu, và là toàn bộ lý do danh sách này tồn tại.
    #[test]
    #[cfg(windows)]
    fn the_windows_install_location_is_looked_at() {
        let looked = well_known();
        assert!(!looked.is_empty(), "LOCALAPPDATA is set on every Windows machine");
        let shown = looked[0].to_string_lossy().to_lowercase();
        assert!(shown.ends_with(r"programs\mixengine\mixengined.exe"), "{shown}");
    }

    /// Bốn trạng thái đi qua wire dạng camelCase — frontend so chuỗi với chúng, nên đổi cách viết
    /// ở đây là làm hỏng cổng vào tab mà không gì lúc build nói ra.
    #[test]
    fn presence_is_camel_cased_for_the_shell() {
        let json = |value: Presence| serde_json::to_string(&value).unwrap();
        assert_eq!(json(Presence::Running), "\"running\"");
        assert_eq!(json(Presence::NotAnswering), "\"notAnswering\"");
        assert_eq!(json(Presence::NotRunning), "\"notRunning\"");
        assert_eq!(json(Presence::NotInstalled), "\"notInstalled\"");
    }
}

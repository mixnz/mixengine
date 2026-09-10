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
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

use crate::error::AppError;

use super::rpc;

/// Tên trần của daemon — một entry của `MIX_BINARIES`, đúng dạng
/// `mixengine_platform::install::program_path` nhận, không đuôi thực thi.
const DAEMON: &str = "mixengined";

/// Chương trình để khởi động một daemon: chỗ máy này thật sự có, không thì tên trần cho `PATH`.
///
/// **Danh sách module này từng tự giữ nay là của `mixengine-platform`** — roadmap task **T107**.
/// Phép đo biện minh cho nó vẫn đúng và đã đi cùng nó sang bên kia: trên máy viết module này
/// MixEngine nằm ở `%LOCALAPPDATA%\Programs\MixEngine` và **không** có trên `PATH` của tiến trình
/// này, vì installer Windows là bản per-user sửa `PATH` của người dùng, còn một tiến trình đang
/// chạy mang theo `PATH` nó thừa kế lúc mở. Cái mới là daemon, các script đóng gói và cửa sổ này
/// giờ đọc **một** câu trả lời thay vì ba.
///
/// Tên trần vẫn ở lại làm nước cuối: một entry `PATH` xuất hiện sau khi tiến trình này khởi động
/// vẫn đáng một lần spawn, và một lần spawn hỏng thì nói ra bằng lời.
fn program() -> OsString {
    mixengine_platform::install::program_path(DAEMON)
        .map_or_else(|| DAEMON.into(), OsString::from)
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

/// Cổng vào tab vẽ gì, và khi không tìm thấy gì thì đã tìm ở đâu — roadmap task **T111**.
///
/// `searched` là danh sách [`mixengine_platform::install::program_path`] đã đi qua, đúng thứ tự, và
/// chỉ được điền cho [`Presence::NotInstalled`]: ba trạng thái kia không tìm gì cả, nên một danh
/// sách rỗng nói đúng điều đó thay vì một danh sách mà phía kia phải nhớ bỏ qua.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceReport {
    pub presence: Presence,
    pub searched: Vec<String>,
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
///
/// **Từ T111 câu trả lời mang theo chỗ đã tìm daemon**, khi không tìm thấy nó.
pub async fn presence() -> PresenceReport {
    let presence =
        match tokio::time::timeout(HEALTH_TIMEOUT, rpc::request("GET", "/health", None)).await {
            Ok(Ok(_)) => Presence::Running,
            // Không tới được endpoint: chưa chạy, hoặc chưa cài. Đó là hai câu khác nhau.
            Ok(Err(error)) if error.code == "error.mixengineUnreachable" => {
                if installed() {
                    Presence::NotRunning
                } else {
                    Presence::NotInstalled
                }
            }
            // Tới được nhưng không xong: một daemon đang kẹt, hoặc một pipe của tài khoản khác.
            _ => Presence::NotAnswering,
        };

    let searched = if presence == Presence::NotInstalled {
        searched()
    } else {
        Vec::new()
    };

    PresenceReport { presence, searched }
}

/// Những thư mục lần tìm đã đi qua, đúng dạng cổng vào tab sẽ in ra.
fn searched() -> Vec<String> {
    mixengine_platform::install::program_search_dirs()
        .iter()
        .map(|dir| dir.display().to_string())
        .collect()
}

/// `mixengined` có trên máy này không. Chỉ hỏi khi đã biết không dial được.
///
/// **Vài lần đọc đĩa, không phải một tiến trình** — roadmap task **T107**. Bản trước chạy
/// `mixengined --version` rồi vứt output đi: một lần tạo tiến trình, một cửa sổ console phải giấu
/// bằng tay, và tới cả giây trong lúc mở tab, để trả lời câu hỏi mà một lần `stat` đã trả lời — và
/// `program_path` hỏi `PATH` bằng cách đọc nó, chứ không bằng cách chạy một chương trình trên đó.
fn installed() -> bool {
    mixengine_platform::install::program_path(DAEMON).is_some()
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

    /// Daemon được tìm ở đúng chỗ platform nói MixEngine nằm, và câu trả lời trên máy này hoặc là
    /// một đường dẫn thật, hoặc là tên trần — không bao giờ là một chương trình rỗng.
    ///
    /// **Nửa per-OS của khẳng định này đã chuyển đi.** Trước đây nó viết thẳng
    /// `programs\mixengine\mixengined.exe` ở đây, cạnh một danh sách module này tự giữ; từ T107
    /// danh sách ấy là `mixengine_platform::install::program_dirs`, và test nêu tên nó cũng vậy.
    #[test]
    fn the_daemon_is_looked_for_where_the_platform_says_mixengine_is() {
        let program = program();

        assert!(!program.is_empty());
        match mixengine_platform::install::program_path(DAEMON) {
            Some(found) => assert_eq!(program, OsString::from(found)),
            None => assert_eq!(program, OsString::from(DAEMON)),
        }
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

    /// Báo cáo đi qua wire dạng một object hai field camelCase — frontend đọc cả hai theo tên, nên
    /// đổi cách viết ở đây là làm hỏng cổng vào tab mà không gì lúc build nói ra.
    #[test]
    fn the_report_is_camel_cased_for_the_shell() {
        let report = PresenceReport {
            presence: Presence::NotInstalled,
            searched: vec!["/somewhere".to_owned()],
        };

        assert_eq!(
            serde_json::to_string(&report).unwrap(),
            r#"{"presence":"notInstalled","searched":["/somewhere"]}"#
        );
    }

    /// Chỗ đã tìm bắt đầu ngay cạnh chương trình này — bước đầu tiên của T107, và cũng đúng thư mục
    /// `npm run dev:app` chép daemon vào (T111).
    #[test]
    fn where_it_looked_begins_beside_this_program() {
        let running = std::env::current_exe().expect("this test has a path");
        let beside = running
            .parent()
            .expect("and a directory")
            .display()
            .to_string();

        assert_eq!(searched().first(), Some(&beside));
    }
}

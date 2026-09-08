//! Lệnh duy nhất của module Tools, và nó **chỉ đọc**.
//!
//! Không có `kill` ở đây và sẽ không bao giờ có: tool in ra lệnh giết tiến trình để người dùng chép
//! và tự chạy, và đó là ranh giới an toàn của cả module chứ không phải sự lười.

use crate::error::AppError;
use crate::platform::{hide_console, in_background};
use std::process::Command;

use super::ports::{self, ListeningPort};

/// Cổng nào trên máy này đang được nghe.
///
/// Chạy trên thread blocking: `netstat` trên một máy có nhiều kết nối mất vài trăm mili giây, và
/// `lsof` còn lâu hơn khi có ổ đĩa mạng.
#[tauri::command]
pub async fn tools_listening_ports() -> Result<Vec<ListeningPort>, AppError> {
    in_background(collect).await
}

/// Chạy một chương trình của hệ điều hành và lấy stdout của nó.
///
/// `hide_console` là bắt buộc, không phải cho đẹp: `netstat`, `tasklist` và `lsof` đều là chương
/// trình console, nên trên Windows mỗi lần mở tool hay bấm Refresh sẽ có một cửa sổ đen loé lên
/// rồi tắt — đúng cái mà người dùng đọc là phần mềm đang chạy lén sau lưng họ. Xem
/// `crate::platform::hide_console`.
fn output_of(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    let out = hide_console(&mut command).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn collect() -> Result<Vec<ListeningPort>, AppError> {
    let netstat = output_of("netstat", &["-ano"])
        .ok_or_else(|| err!("error.portScanFailed", tool = "netstat"))?;
    // Không tra được tên tiến trình thì bảng vẫn có ích: cổng và PID đã trả lời được câu hỏi chính.
    let tasklist = output_of("tasklist", &["/FO", "CSV", "/NH"]).unwrap_or_default();
    Ok(ports::parse_netstat(&netstat, &tasklist))
}

#[cfg(target_os = "linux")]
fn collect() -> Result<Vec<ListeningPort>, AppError> {
    if let Some(text) = output_of("ss", &["-lntp"]) {
        return Ok(ports::parse_ss(&text));
    }
    // Máy không có `ss` thì lùi về `lsof` — cùng bộ đọc với macOS.
    let text = output_of("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])
        .ok_or_else(|| err!("error.portScanFailed", tool = "ss"))?;
    Ok(ports::parse_lsof(&text))
}

#[cfg(target_os = "macos")]
fn collect() -> Result<Vec<ListeningPort>, AppError> {
    let text = output_of("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])
        .ok_or_else(|| err!("error.portScanFailed", tool = "lsof"))?;
    Ok(ports::parse_lsof(&text))
}

#[cfg(test)]
mod tests {
    /// Chạy lệnh thật của máy đang chạy test và đọc kết quả.
    ///
    /// `#[ignore]` vì nó phụ thuộc máy: một container CI không có cổng nào đang nghe, và trên
    /// Linux nó còn cần `ss` hoặc `lsof` có mặt. Chạy tay bằng
    /// `cargo test -- --ignored` trên một máy để bàn — đây là thứ duy nhất chứng minh nửa I/O
    /// nối đúng với nửa bộ đọc, thứ mà fixture không nói được.
    #[test]
    #[ignore]
    fn quet_duoc_cong_that_cua_may_nay() {
        let ports = super::collect().expect("chạy được lệnh của hệ điều hành");

        // Một máy để bàn luôn có ít nhất một cổng đang nghe.
        assert!(!ports.is_empty(), "không thấy cổng nào đang nghe");
        // Cổng 0 nghĩa là bộ đọc đọc trượt cột.
        assert!(ports.iter().all(|p| p.port != 0), "có cổng đọc ra 0");
        // Ít nhất một dòng phải tra được tên tiến trình; không cái nào là dấu hiệu bảng tên hỏng.
        assert!(
            ports.iter().any(|p| p.process.is_some()),
            "không dòng nào tra được tên tiến trình"
        );
    }
}

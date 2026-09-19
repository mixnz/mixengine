//! Thứ module này giữ giữa hai lệnh: đúng một stream sự kiện đang mở.
//!
//! **One per window** since T168a: the tray panel is a second webview with its own `daemonWatch.ts`,
//! and a single slot meant the panel opening its stream closed the main window's — the Dashboard
//! would silently stop updating whenever somebody clicked the tray icon.
//!
//! Một tab một stream là sai. Bus sự kiện bên MixEngine là bus chung, sức chứa 1024 message, và
//! hai tab MixEngine mở cùng lúc sẽ là hai kết nối `/events` cùng đọc nó. Một stream, mọi tab
//! nghe cùng một `Channel`, là đủ cho pha này — log có stream riêng theo service ([ADR 0009 bên
//! MixEngine]: log không bao giờ là sự kiện), giữ trong `LogsState` ngay dưới đây, tách hẳn khỏi
//! `MixEngineState`.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct MixEngineState {
    /// Keyed by webview label (`main`, `tray`).
    open: Mutex<HashMap<String, CancellationToken>>,
}

impl MixEngineState {
    /// Cancels this window's open stream, if any, and keeps the new one. Another window's stream
    /// is left alone.
    pub fn keep(&self, window: &str, token: CancellationToken) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = open.insert(window.to_owned(), token) {
            previous.cancel();
        }
    }

    /// Closes this window's open stream. Calling it twice is harmless.
    pub fn stop(&self, window: &str) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(token) = open.remove(window) {
            token.cancel();
        }
    }
}

/// Đúng một stream log đang mở — riêng với `MixEngineState`, vì `/events` và `/logs/service/{id}`
/// là hai kết nối cùng lúc, không phải một cái thay cái kia. Cùng hình dạng `keep`/`stop`, tách struct
/// vì Tauri khoá state theo kiểu: gộp chung sẽ là hai stream chia nhau một khoá, và mở Logs sẽ đóng
/// `/events` đang mở cho Dashboard.
#[derive(Default)]
pub struct LogsState {
    open: Mutex<Option<CancellationToken>>,
}

impl LogsState {
    pub fn keep(&self, token: CancellationToken) {
        let mut slot = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = slot.replace(token) {
            previous.cancel();
        }
    }

    pub fn stop(&self) {
        let mut slot = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(token) = slot.take() {
            token.cancel();
        }
    }
}

/// Đúng một stream `/metrics` đang mở — riêng với `MixEngineState`/`LogsState`, vì Dashboard giữ
/// `/events` **và** `/metrics` cùng lúc: gộp chung với một trong hai sẽ để một cái giành khoá của
/// cái kia. Không tái dùng `LogsState` cho việc này dù cùng là "một stream" — `/logs/{id}` và
/// `/metrics` có thể cùng mở một lúc khi Logs và Dashboard cùng ở trạng thái đã-xem-qua
/// (`mountedScreens` giữ mọi màn trong DOM).
///
/// **Đóng stream này có ý nghĩa khác đóng hai cái kia.** `/events`/`/logs` đóng vì không ai đọc nữa;
/// `/metrics` đóng còn đổi hành vi của daemon — mở kết nối này khiến daemon lấy mẫu 1 Hz, đóng nó
/// trả daemon về 1 lần/phút. `stop()` ở đây phải được gọi đúng lúc Dashboard không còn `active`,
/// không chỉ lúc unmount.
#[derive(Default)]
pub struct MetricsState {
    open: Mutex<Option<CancellationToken>>,
}

impl MetricsState {
    pub fn keep(&self, token: CancellationToken) {
        let mut slot = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(previous) = slot.replace(token) {
            previous.cancel();
        }
    }

    pub fn stop(&self) {
        let mut slot = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(token) = slot.take() {
            token.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mở cái thứ hai là đóng cái thứ nhất — nếu không, một tab mở lại sẽ để lại một kết nối
    /// `/events` không ai đọc, chạy tới lúc app thoát.
    #[test]
    fn a_second_stream_cancels_the_first() {
        let state = MixEngineState::default();
        let first = CancellationToken::new();
        state.keep("main", first.clone());
        assert!(!first.is_cancelled());

        let second = CancellationToken::new();
        state.keep("main", second.clone());
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());

        state.stop("main");
        assert!(second.is_cancelled());
    }

    /// The tray panel opening and closing its stream must never touch the main window's.
    #[test]
    fn each_window_keeps_its_own_stream() {
        let state = MixEngineState::default();
        let main = CancellationToken::new();
        let tray = CancellationToken::new();
        state.keep("main", main.clone());
        state.keep("tray", tray.clone());
        assert!(!main.is_cancelled());
        assert!(!tray.is_cancelled());

        state.stop("tray");
        assert!(tray.is_cancelled());
        assert!(!main.is_cancelled());

        let tray_again = CancellationToken::new();
        state.keep("tray", tray_again.clone());
        assert!(!main.is_cancelled());
    }

    /// Đóng khi không có gì mở, và đóng hai lần, đều không được panic: `mixengine_unwatch` chạy từ
    /// cleanup của một effect và effect chạy hai lần trong StrictMode.
    #[test]
    fn stopping_nothing_is_harmless() {
        let state = MixEngineState::default();
        state.stop("main");
        state.stop("main");
        state.stop("a window that never watched");
    }
}

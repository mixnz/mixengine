//! Terminal: một phiên shell, trên máy này hoặc trên một máy chủ qua SSH.
//!
//! Chỗ khác nhau giữa hai loại phiên nằm gọn trong hàm dựng phiên; từ `commands.rs` trở lên chỉ
//! còn một `Session` và một đường ra.

pub mod commands;
pub mod local;
pub mod models;
pub mod remote;
pub mod state;
pub mod stream;

/// Đặt state của module vào app. Gọi một lần, từ `lib.rs`.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(state::TerminalState::default())
}

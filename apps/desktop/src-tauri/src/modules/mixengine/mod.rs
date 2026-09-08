//! Nói chuyện với daemon của MixEngine. Xem
//! `docs/superpowers/specs/2026-09-06-mixengine-transport-design.md`.

pub mod commands;
pub mod endpoint;
pub mod events;
pub mod health;
pub mod logs;
pub mod metrics;
pub mod open_in_mixdb;
pub mod rpc;
pub mod sse;
pub mod state;
pub mod transport;

/// Đặt state của module vào app. Tauri khóa state theo kiểu, nên nó không bao giờ gặp state của
/// module khác.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(state::MixEngineState::default())
        .manage(state::LogsState::default())
        .manage(state::MetricsState::default())
}

//! REST client: sending one HTTP request and handing back what came of it.
//!
//! Deliberately thin. Which URL, which headers, how a form is encoded and what content type to
//! declare are all settled in `src/modules/rest/` before anything arrives here — see the spec's
//! "Rust is just plumbing".

pub mod commands;
pub mod models;
pub mod preview;
pub mod state;

/// Puts this module's own state in the app, and the scheme the response Preview is served from.
/// Called once, from `lib.rs`.
///
/// Tauri keys managed state by type, so this never meets `db`'s.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(state::RestState::default())
        .register_uri_scheme_protocol(preview::SCHEME, preview::respond)
}

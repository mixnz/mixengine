//! MixEngine in the tray or the menu bar — T168.
//!
//! The icon and a second webview window, label [`PANEL`], that draws the same React code as the
//! Dashboard (`src/tray.tsx`). The design, including why Linux gets a menu in front of the panel
//! rather than a popover, is `docs/superpowers/specs/2026-09-19-t168-mixengine-in-the-tray-design.md`.

use tauri::{AppHandle, Manager, Runtime};

/// The label of the panel's window, and of its capability (`capabilities/tray.json`).
pub const PANEL: &str = "tray";

/// Shows, unminimises and focuses the main window, and puts the panel away.
#[tauri::command]
pub fn tray_open_main(app: AppHandle) {
    hide_panel(&app);
    crate::launch::bring_to_front(&app);
}

/// Puts the panel away — Esc, or a click on a row that opens something elsewhere.
#[tauri::command]
pub fn tray_hide_panel(app: AppHandle) {
    hide_panel(&app);
}

/// Quits MixLab. The daemon is left running: stopping it is `mixengine_shutdown`, a different
/// button. `RunEvent::Exit` in `lib.rs` still runs, so the single-instance endpoint is cleaned up.
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

fn hide_panel<R: Runtime>(app: &AppHandle<R>) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.hide();
    }
}

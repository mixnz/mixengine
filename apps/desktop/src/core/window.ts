import { invoke } from "@tauri-apps/api/core";

/**
 * The application's own windows — the shell's, not any module's. `src-tauri/src/tray.rs`.
 */

/** Shows and focuses the main window, and hides the tray panel. */
export function openMainWindow(): Promise<void> {
  return invoke("tray_open_main");
}

/** Hides the tray panel. */
export function hideTrayPanel(): Promise<void> {
  return invoke("tray_hide_panel");
}

/** Quits MixLab. The daemon keeps running. */
export function quitApp(): Promise<void> {
  return invoke("app_quit");
}

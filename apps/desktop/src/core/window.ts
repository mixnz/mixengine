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

/** The Linux tray menu's words, which Rust does not keep a dictionary for. */
export interface TrayLabels {
  openPanel: string;
  openMain: string;
  quit: string;
}

/**
 * Turns the tray icon on or off. `enabled` is "a module this window draws has a tray panel"; the
 * backend still decides whether this session can show an icon at all.
 */
export function configureTray(enabled: boolean, labels: TrayLabels): Promise<void> {
  return invoke("tray_configure", { enabled, labels });
}

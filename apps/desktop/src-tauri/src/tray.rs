//! MixEngine in the tray or the menu bar — T168.
//!
//! The icon and a second webview window, label [`PANEL`], that draws the same React code as the
//! Dashboard (`src/tray.tsx`). The design, including why Linux gets a menu in front of the panel
//! rather than a popover, is `docs/superpowers/specs/2026-09-19-t168-mixengine-in-the-tray-design.md`.
//!
//! **The icon exists only while the frontend says so.** `tray_configure` is called by the main
//! window once it knows which modules it draws: a MixLab used only as a database client (T108) has
//! nothing to put in a panel and gets no icon. While there is an icon, closing the main window
//! hides it instead of quitting; without one, closing quits, as it always did.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Builder, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindowBuilder,
    Window, WindowEvent,
};

use crate::error::AppError;

/// The label of the panel's window, and of its capability (`capabilities/tray.json`).
pub const PANEL: &str = "tray";

/// The label of the main window, as `tauri.conf.json` declares it.
const MAIN: &str = "main";

/// The tray icon's id — there is only ever one.
const ICON: &str = "mixengine";

/// The panel's size in logical pixels. On Linux it is a normal window and this is its minimum.
const PANEL_WIDTH: f64 = 360.0;
const PANEL_HEIGHT: f64 = 520.0;

/// A click on the icon this soon after the panel hid itself on blur is the same gesture, not a
/// new one: clicking the icon takes focus from the panel first, and the click arrives after.
const BLUR_DEBOUNCE: Duration = Duration::from_millis(250);

/// The three words the Linux menu needs, sent by the frontend so that Rust holds no dictionary.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub struct Labels {
    pub open_panel: String,
    pub open_main: String,
    pub quit: String,
}

#[derive(Default)]
pub struct TrayState {
    /// Whether the icon is up, and with it whether closing the main window hides it.
    enabled: AtomicBool,
    /// When the panel last hid itself because it lost focus — see [`BLUR_DEBOUNCE`].
    blur_hidden_at: Mutex<Option<Instant>>,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    labels: Mutex<Labels>,
    /// Whether this session can show a tray icon at all, asked once — see [`has_host`].
    host: OnceLock<bool>,
}

impl TrayState {
    fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    fn host(&self) -> bool {
        *self.host.get_or_init(has_host)
    }

    fn mark_blur_hide(&self) {
        *self
            .blur_hidden_at
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    }

    fn just_blur_hidden(&self) -> bool {
        self.blur_hidden_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|at| at.elapsed() < BLUR_DEBOUNCE)
    }
}

/// Puts the tray's state in and routes window events through [`on_window_event`].
pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .manage(TrayState::default())
        .on_window_event(on_window_event)
}

/// Creates the panel's window, hidden. Called from `setup`, once.
///
/// Created up front rather than on the first click: a webview takes a visible half-second to come
/// up, and a panel is something a person expects the instant they click. It is never destroyed.
pub fn create_panel<R: Runtime>(app: &AppHandle<R>) {
    let builder = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("tray.html".into()))
        .title("MixEngine")
        .visible(false)
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT);

    #[cfg(not(target_os = "linux"))]
    let builder = builder
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible_on_all_workspaces(true);

    // On Linux the panel is an ordinary window the window manager places — the spec's D1.
    #[cfg(target_os = "linux")]
    let builder = builder.min_inner_size(PANEL_WIDTH, PANEL_HEIGHT);

    if let Err(e) = builder.build() {
        // No panel means no tray, never no MixLab.
        log::error!("tray: the panel window could not be created: {e}");
    }
}

/// Turns the icon on or off, and gives it the words for its Linux menu.
///
/// Called by the main window whenever the modules it draws or its language change. `enabled` is
/// "a visible module has a tray panel"; whether this session can show an icon at all is decided
/// here, not there.
#[tauri::command]
pub fn tray_configure(
    app: AppHandle,
    state: tauri::State<'_, TrayState>,
    enabled: bool,
    labels: Labels,
) -> Result<(), AppError> {
    *state.labels.lock().unwrap_or_else(|e| e.into_inner()) = labels;
    let enabled = enabled && state.host();

    if enabled {
        if app.tray_by_id(ICON).is_none() {
            create_icon(&app)?;
        } else {
            #[cfg(target_os = "linux")]
            refresh_menu(&app, &state);
        }
    } else {
        app.remove_tray_by_id(ICON);
        hide_panel(&app);
    }

    let was = state.enabled.swap(enabled, Ordering::SeqCst);
    if was && !enabled {
        // Nobody may be left with a running app and no way to see it.
        crate::launch::bring_to_front(&app);
    }
    Ok(())
}

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

/// Puts the app back in the Dock before a window of it is shown. The other half is in
/// [`on_window_event`], where hiding the main window takes it out.
pub(crate) fn show_in_dock<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

fn hide_panel<R: Runtime>(app: &AppHandle<R>) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.hide();
    }
}

fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<TrayState>();
    match (window.label(), event) {
        // A popover goes away when you click anywhere else. Not on Linux, where it is a window.
        #[cfg(not(target_os = "linux"))]
        (PANEL, WindowEvent::Focused(false)) => {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
                state.mark_blur_hide();
            }
        }
        // The panel is never destroyed: Alt+F4 or its close button only puts it away.
        (PANEL, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = window.hide();
        }
        (MAIN, WindowEvent::CloseRequested { api, .. }) if state.enabled() => {
            api.prevent_close();
            let _ = window.hide();
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
        // Without a tray, closing the main window is quitting — and the hidden panel would
        // otherwise keep the process alive with nothing on screen.
        (MAIN, WindowEvent::Destroyed) => app.exit(0),
        _ => {}
    }
}

fn create_icon(app: &AppHandle) -> Result<(), AppError> {
    let builder = TrayIconBuilder::with_id(ICON).tooltip("MixEngine");

    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(tauri::include_image!("icons/tray/44x44.png"))
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    };

    #[cfg(not(target_os = "linux"))]
    let builder = builder
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| on_icon_event(tray.app_handle(), event));

    #[cfg(target_os = "linux")]
    let builder = builder
        .menu(&linux_menu(app, &app.state::<TrayState>())?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()));

    builder
        .build(app)
        .map(|_| ())
        .map_err(|e| err!("error.trayUnavailable", message = e))
}

#[cfg(not(target_os = "linux"))]
fn on_icon_event(app: &AppHandle, event: tauri::tray::TrayIconEvent) {
    use tauri::tray::{MouseButtonState, TrayIconEvent};

    // Either button: a right click on a Windows tray icon is expected to do something.
    let TrayIconEvent::Click {
        rect,
        position,
        button_state: MouseButtonState::Up,
        ..
    } = event
    else {
        return;
    };
    let Some(panel) = app.get_webview_window(PANEL) else {
        return;
    };

    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    if app.state::<TrayState>().just_blur_hidden() {
        return;
    }

    if let Ok(Some(monitor)) = app.monitor_from_point(position.x, position.y) {
        let scale = monitor.scale_factor();
        let icon = rect.position.to_physical::<f64>(scale);
        let icon_size = rect.size.to_physical::<f64>(scale);
        let work = monitor.work_area();
        let (x, y) = panel_position(
            Bounds {
                x: icon.x,
                y: icon.y,
                width: icon_size.width,
                height: icon_size.height,
            },
            (PANEL_WIDTH * scale, PANEL_HEIGHT * scale),
            Bounds {
                x: f64::from(work.position.x),
                y: f64::from(work.position.y),
                width: f64::from(work.size.width),
                height: f64::from(work.size.height),
            },
        );
        let _ = panel.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
    let _ = panel.show();
    let _ = panel.set_focus();
}

/// Whether this session can show a tray icon. macOS and Windows always can.
#[cfg(not(target_os = "linux"))]
fn has_host() -> bool {
    true
}

/// Linux lands in T168d; until then there is no tray there.
#[cfg(target_os = "linux")]
fn has_host() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn linux_menu(
    app: &AppHandle,
    state: &TrayState,
) -> Result<tauri::menu::Menu<tauri::Wry>, AppError> {
    let _ = (app, state);
    Err(err!("error.trayUnavailable", message = "not yet"))
}

#[cfg(target_os = "linux")]
fn refresh_menu(app: &AppHandle, state: &TrayState) {
    let _ = (app, state);
}

#[cfg(target_os = "linux")]
fn on_menu_event(app: &AppHandle, id: &str) {
    let _ = (app, id);
}

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Where the panel's top-left corner goes, for an icon at `icon` on a monitor whose usable area is
/// `work`.
///
/// Below the icon when the icon sits in the top half of that area — the macOS menu bar, a Windows
/// taskbar moved to the top — and above it otherwise; centred on the icon, then kept inside the
/// area. A taskbar on the left or right puts the icon in neither half in particular, and the clamp
/// is what keeps the panel on screen there.
fn panel_position(icon: Bounds, panel: (f64, f64), work: Bounds) -> (f64, f64) {
    let (width, height) = panel;
    let icon_centre_y = icon.y + icon.height / 2.0;
    let below = icon_centre_y < work.y + work.height / 2.0;

    let x = icon.x + icon.width / 2.0 - width / 2.0;
    let y = if below {
        icon.y + icon.height
    } else {
        icon.y - height
    };

    let x = x.clamp(work.x, (work.x + work.width - width).max(work.x));
    let y = y.clamp(work.y, (work.y + work.height - height).max(work.y));
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PANEL_SIZE: (f64, f64) = (360.0, 520.0);

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_menu_bar_icon_gets_the_panel_under_it() {
        // macOS: a 1440×900 screen whose work area starts under a 25px menu bar.
        let icon = bounds(1200.0, 0.0, 24.0, 24.0);
        let work = bounds(0.0, 25.0, 1440.0, 875.0);
        let (x, y) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(x, 1212.0 - 180.0);
        assert_eq!(y, 25.0, "clamped just under the menu bar");
    }

    #[test]
    fn a_bottom_taskbar_icon_gets_the_panel_above_it() {
        let icon = bounds(1500.0, 1050.0, 24.0, 30.0);
        let work = bounds(0.0, 0.0, 1920.0, 1040.0);
        let (x, y) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(x, 1512.0 - 180.0);
        assert_eq!(
            y,
            1040.0 - 520.0,
            "kept inside the work area, above the taskbar"
        );
    }

    #[test]
    fn a_top_taskbar_icon_gets_the_panel_below_it() {
        let icon = bounds(1500.0, 5.0, 24.0, 30.0);
        let work = bounds(0.0, 40.0, 1920.0, 1040.0);
        let (_, y) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(y, 40.0);
    }

    #[test]
    fn an_icon_at_the_right_edge_keeps_the_panel_on_screen() {
        let icon = bounds(1900.0, 1050.0, 20.0, 30.0);
        let work = bounds(0.0, 0.0, 1920.0, 1040.0);
        let (x, _) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(x, 1920.0 - 360.0);
    }

    #[test]
    fn a_left_taskbar_keeps_the_panel_inside_the_work_area() {
        // The taskbar is 60px wide on the left; the icon is low on it.
        let icon = bounds(18.0, 900.0, 24.0, 24.0);
        let work = bounds(60.0, 0.0, 1860.0, 1080.0);
        let (x, y) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(x, 60.0);
        assert_eq!(y, 900.0 - 520.0);
    }

    #[test]
    fn a_right_taskbar_keeps_the_panel_inside_the_work_area() {
        let icon = bounds(1880.0, 200.0, 24.0, 24.0);
        let work = bounds(0.0, 0.0, 1860.0, 1080.0);
        let (x, y) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(x, 1860.0 - 360.0);
        assert_eq!(y, 224.0);
    }

    #[test]
    fn a_monitor_left_of_the_primary_one_has_negative_coordinates() {
        let icon = bounds(-300.0, 1050.0, 24.0, 30.0);
        let work = bounds(-1920.0, 0.0, 1920.0, 1040.0);
        let (x, y) = panel_position(icon, PANEL_SIZE, work);
        assert_eq!(x, -288.0 - 180.0);
        assert_eq!(y, 520.0);
    }

    #[test]
    fn a_scaled_monitor_is_measured_in_physical_pixels() {
        // 150%: the caller hands in the panel at 540×780 and the rest in physical pixels too.
        let icon = bounds(2000.0, 1560.0, 36.0, 45.0);
        let work = bounds(0.0, 0.0, 2880.0, 1560.0);
        let (x, y) = panel_position(icon, (540.0, 780.0), work);
        assert_eq!(x, 2018.0 - 270.0);
        assert_eq!(y, 1560.0 - 780.0);
    }

    #[test]
    fn a_panel_larger_than_the_work_area_starts_at_its_corner() {
        let icon = bounds(100.0, 10.0, 24.0, 24.0);
        let work = bounds(0.0, 0.0, 300.0, 400.0);
        assert_eq!(panel_position(icon, PANEL_SIZE, work), (0.0, 0.0));
    }
}

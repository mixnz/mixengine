# Phase 22 — MixEngine in the tray

*Goal: MixEngine has an icon in the tray or menu bar on all three systems. One click shows what is
running, starts and stops it, stops everything, shuts MixEngine down and opens MixLab, and MixLab can
start there at login with no window.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-19-t168-mixengine-in-the-tray-design.md](../../docs/superpowers/specs/2026-09-19-t168-mixengine-in-the-tray-design.md).
Decision: [ADR 0042](../decisions/0042-mixlab-starts-at-login-when-a-person-asks-it-to.md).

---

- [x] **T168a** One event stream per window. `MixEngineState` keys its token by webview label, so the
      tray panel's stream never closes the main window's.
- [x] **T168b** The commands the panel needs and MixLab lacked: `mixengine_shutdown`
      (`daemon.shutdown`), `tray_open_main`, `tray_hide_panel`, `app_quit`.
- [x] **T168c** `tray.rs` on macOS and Windows: the icon, the hidden `tray` window, `panel_position`,
      blur-hide with its 250 ms debounce, close-to-tray, and the macOS activation policy. **(P)**
- [x] **T168d** Linux: the three-item menu, the `dlopen` and StatusNotifierWatcher checks, the
      AppIndicator dependency in the `.deb` and `.rpm`, and `AppRun`'s note. **(P)**
- [x] **T168e** The panel: the `TrayPanel` slot on `ModuleDefinition`, the `tray.html` entry, the
      header with the slogan, services, stop-all, sites, the footer, and inline confirmation.
- [x] **T168f** MixLab at login: `tauri-plugin-autostart` with `--hidden`, `main` hidden until shown,
      the Settings switch beside the daemon's, and the AppImage and development-build names. **(P)**
- [ ] **T168g** The tray icons, and `client-surface.md`, the desktop roadmap, the architecture notes
      and the handbook brought up to date.

**Milestone M22**: on macOS and Windows, a person who ticked the login switch sees the icon after
signing in with no window. From the panel they can stop MariaDB, stop everything and shut MixEngine
down without opening MixLab, confirming the last two. On Ubuntu the same works through **Open control
panel**.

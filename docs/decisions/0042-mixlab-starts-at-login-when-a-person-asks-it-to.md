# 0042. MixLab starts at login when a person asks it to, and separately from the daemon

**Status**: Accepted
**Date**: 2026-09-19

## Context

T168 puts MixEngine in the tray: an icon, and a panel that lists services and sites, starts and
stops them, and opens MixLab
([the design](../specs/2026-09-19-t168-mixengine-in-the-tray-design.md)). The
icon is drawn by MixLab's process, so it is only there while MixLab runs. A tray icon that exists
only once somebody has opened the window already is of little use, so MixLab has to be able to start at login,
with no window.

[ADR 0016](0016-autostart-is-registered-by-mixengine.md) already decided the matching question for
the daemon: `autostart.enable` registers the entry, a person asks for it, and no installer does.
It left the window's own start at login unaddressed, because the window had no reason to start on
its own until now.

Two facts shape the answer:

- **The daemon and the window are different things to start.** A person using `mix` from a
  terminal wants the daemon at login and no window. A person who uses MixLab as a database client,
  with the `mixengine` module hidden (T108), may want the window and no daemon. Most people want both,
  but the product has already been built so that each works without the other.
- **The window's autostart is not a daemon capability.** It changes nothing the daemon owns, and
  `mix` has nothing to do with it, in the same way `mix` has nothing to do with the window's remembered
  size. *No client-only capability* is about mutating API methods, and this one never reaches the API.

## Decision

1. **MixLab registers its own login entry, only when a person turns on *Open MixLab in the tray at
   login* in Settings. It is off by default and no installer turns it on.** This is ADR 0016's rule,
   applied to the window.
2. **It is a second switch, beside the daemon's, not merged into it.** Starting at login, MixLab
   does not start the daemon. If the daemon is down, the tray panel says so and offers to start it.
3. **The entry starts MixLab with `--hidden`.** The main window stays hidden and only the tray
   appears. On a Linux session with no StatusNotifierItem host, where no icon would be drawn, a
   hidden start shows the window instead, because an invisible running app is worse than a window.
4. **The switch shows what the operating system holds, not what MixLab remembers.** The entry can be
   removed from System Settings, Task Manager or a desktop environment's startup list without
   MixLab knowing.

## Consequences

- A person who wants the whole product at login ticks two boxes, and the Settings screen puts them
  next to each other so the second one is not missed.
- `tauri-plugin-autostart` becomes a dependency of MixLab. It writes a LaunchAgent on macOS, an
  `HKCU\…\Run` value on Windows and an XDG autostart `.desktop` file on Linux.
- An AppImage's entry names `$APPIMAGE`. A development build never registers one, and its name
  carries the development suffix, so it cannot overwrite a release's entry (ADR 0024, ADR 0040).
- Uninstalling MixEngine has to remove this entry as well. `daemon.uninstall` does not know about
  it, so MixLab removes it when it is told the home is going. This is a follow-up in T168f.

## Alternatives considered

**One switch that starts both.** It is simpler to explain, but it forces the daemon on the person
who only wants the database client, and the window on the person who only uses `mix`. Both groups
already exist.

**The daemon starts the window.** The daemon would be launching a GUI process into a session it
may not have. On Linux it may be a systemd user unit with no display, and CLAUDE.md keeps GUI out of
the daemon.

**On by default after install.** Rejected for the reason ADR 0016 gives: a program that starts
itself at login because somebody installed it is a program that decided something for them.

# Phase 12 — One product

*Goal: one download installs everything, one updater keeps everything current, and a MixDB user
loses nothing by switching.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-08-the-desktop-client-in-this-repository-design.md](../../docs/superpowers/specs/2026-09-08-the-desktop-client-in-this-repository-design.md),
on [ADR 0027](../decisions/0027-the-desktop-client-lives-in-this-repository.md).

---

**This is the phase the users asked for.** The two complaints ADR 0027 opens with — *two downloads*
and *a database client I did not want* — are answered by this phase and the next respectively.
Phase 11 made the window buildable here; this one makes it *the* window, named MixLab,
inside MixEngine's installers, replaced by MixEngine's updater.

- [x] **T104** The application is MixLab. Product name, identifier `io.github.mixnz.mixlab`,
      executable names, window title and icon per the design's D6 — and only those: the daemon,
      the CLI, the home and the installers keep MixEngine's name. A mark of MixLab's own replaces
      MixDB's two SVGs, derived from MixEngine's until one is drawn. **And the version becomes the workspace's**: the three fields the desktop
      build reads are held to `[workspace.package].version` by `packaging.rs` from here on — held
      back from T101 because a lower version under MixDB's still-wired updater is an app that
      offers to replace itself with standalone MixDB. **And a MixDB user's data comes across, once** (D7): on the first launch
      that finds no settings, the store files are copied and the keyring entries they name are
      read under service `MixDB` and written under the new one — the old directory and the old
      entries never touched, a marker file so it never runs twice, `keyringRef`s into MixEngine's
      namespace copied as they are, and nothing from the webview's `localStorage`: theme and the
      last tab strip are not things a person made. An import found sets the profile to *Everything* once T108
      exists; until then it changes nothing visible. **(P)** — three application-data locations,
      three keyrings.
      Design: [2026-09-09-t104-the-application-is-mixlab-design.md](../../docs/superpowers/specs/2026-09-09-t104-the-application-is-mixlab-design.md).
      **Three things this task settled.** The mark is drawn here rather than handed over: the
      design's D6 expects the owner's SVGs and they have not arrived, so `public/logo.svg` draws
      D6's description — a ring open at the lower right, an `ML` ligature whose `L` leaves through
      the gap — in one cut whose weights hold at 16 px, and the second, heavier cut waits for them.
      The import is Rust on both halves rather than the vitest-and-Rust split the design imagined:
      the file copy has to run inside `setup()`, before the event loop can deliver the webview's
      first `Store.load`, and that is the only moment in which it is race-free. And **the version
      drop was not safe on its own**: D6 argued that the rename moves the application out of
      MixDB's install directory, which is true only on Windows — on macOS and Linux
      `tauri-plugin-updater` replaces the *running bundle*, so a window on `0.0.6` offered MixDB
      `0.0.33` would have overwritten itself with it. The plugin stays wired for T106; the frontend
      stops calling it.

- [x] **T105** The window is in every installer, and the headless archive stays (D8).
      `MIX_BINARIES` and `MIX_CRATES` gain the fifth entry and `packaging.rs` holds the list. NSIS
      gets a Start Menu shortcut, an optional desktop shortcut and the `mixdb://` registration;
      the `.pkg` places `MixLab.app` in `/Applications`; `.deb` and `.rpm` add a `.desktop` file
      and declare WebKitGTK; the AppImage's `AppRun` starts the window when given no arguments and
      runs `mix` with them otherwise. A new
      `mixengine-<version>-<os>-<arch>-headless` archive carries the four binaries and nothing
      else. Each script's own check — *the binaries are really in there* — counts five, or four
      for the headless one. **(P)**
      Design: [2026-09-09-t105-the-window-in-every-installer-design.md](../../docs/superpowers/specs/2026-09-09-t105-the-window-in-every-installer-design.md).
      **Two things this task settled.** The executable is `mixlab` on every operating system and not
      D6's `MixLab.exe` on Windows: `updates::apply::swap` looks a payload's name up as
      `directory.join(binary_name(name))` and `binary_name` appends `EXE_SUFFIX` and nothing else,
      so a capitalised install file is one T106's updater would skip for ever without a word — no
      error anywhere, just a window that never updates. What a Windows user clicks is a Start Menu
      shortcut, and that is named MixLab. And **the AppImage does not carry WebKitGTK**, contrary to
      one line of D8: appimagetool bundles no libraries, and doing it means `linuxdeploy` and its
      GTK plugin — a dependency and a failure mode of a different size. `AppRun` fails in words
      naming the package to install instead, and bundling is T105a below. Two smaller things fell
      out: the window is built by a script of its own (`packaging/desktop.sh`) because `stage.sh`
      builds with `cargo -p` from a root that excludes that crate, and `feed.sh` had to learn to
      skip `*-headless.*` — the new archives match its payload globs, and one left in would have
      stopped the whole `release` job at "is not a payload name this script recognises".

- [ ] **T105a** The AppImage carries the libraries the window needs (D8). `linuxdeploy` and its GTK
      plugin, or the measurement that says a distribution floor is cheaper than carrying WebKitGTK.
      Until then the AppImage's window uses the system's WebKitGTK 4.1 and `AppRun` says so by name
      when it is missing; the command line inside the same image is unaffected either way. **(P)**

- [ ] **T106** One updater (D9). `tauri-plugin-updater`, `tauri-plugin-process`, MixDB's key, its
      `latest.json` and `update-notes.yml` are gone. The feed's `provides` and the payload carry
      the desktop executable; `feed-check.sh` asserts it. **`updates::apply` replaces what the
      install has and adds nothing** — a headless install stays headless, and an install from
      before this release is told in the release notes that the window arrives by installer. After
      `UpdateApplied` the window relaunches itself the way the daemon does. **(P)** — on Windows a
      running executable is renamed, never overwritten, and the window is the running one.

- [ ] **T107** Where the daemon is, and where the window is, are both the platform's to answer
      (D9, D10). `health.rs`'s hand-kept `well_known()` is replaced by one `mixengine-platform`
      function — the executable's own directory, then the OS's install location, then `PATH` —
      that packaging reads too. `mixengine-platform`'s desktop-application lookup learns the merged
      application's location beside standalone MixDB's, so `mix database open` from a terminal
      opens a tab in the running window, password in the environment and nowhere else, exactly as
      T83 specified. `mixdb://`, `launch.rs` and `instance.rs` stay. **(P)**

**Milestone M12** — on a clean machine of each OS, one installer installs the daemon, the CLI, the
helper, the shim and the window; the window's Update button and `mix self-update` each replace all
five; a MixDB user's saved connections open in the new window with their passwords; `mix database
open` from a terminal lands in a tab; the uninstaller leaves nothing (T87's smoke, extended).
`mixnz/mixdb` is archived on the day this ships.

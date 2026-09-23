---
status: draft
date: 2026-09-23
task: T88f
---

# A `.pkg` is updated by its installer

The design behind [ADR 0050](../decisions/0050-a-copy-the-pkg-installed-is-updated-by-the-pkg.md):
on macOS, a copy of MixEngine that the `.pkg` installed is updated by handing the next release's
`.pkg` to Installer.app. MixEngine downloads and verifies the package, the person installs it, and
MixEngine restarts once the new binaries are on disk.

## Goal

A person who installed MixLab from the `.pkg` presses **Update** in MixLab, or runs
`mix self-update`, and ends up with the new `mix`, `mixengined`, `mixengine-shim`, `MixLab.app` and
`mixengine-elevate`, with the services that were running running again. Nothing in MixEngine
elevates to get there.

## Not in scope

- Windows, the archives and Linux. Their paths do not change (ADR 0050, decision 5).
- A silent install behind a password prompt only. That is the alternative ADR 0050 rejected for now.
- Getting a copy of v0.0.7 onto this path. It cannot be done: the updating code is the installed
  code (ADR 0050, decision 6).

## Measurements to take first

Nothing below is final until these are read on a Mac with macOS 15 or later, with v0.0.7 installed
from its `.pkg`. Each one can change a decision, and the decision it can change is named.

| # | Question | How | Changes |
| --- | --- | --- | --- |
| M1 | Does `pkgutil --file-info /usr/local/bin/mixengined` name `dev.mixengine.cli`? | Run it after installing v0.0.7's `.pkg` | D1. If it does not, the receipt check needs another form, for example `pkgutil --pkg-info dev.mixengine.cli` plus the path |
| M2 | Does a `.pkg` fetched by a process that is not a browser carry `com.apple.quarantine`? Does Installer.app then open it without a Gatekeeper refusal? | `curl -LO` the v0.0.7 `.pkg`, `xattr -l` it, `open` it | D5. If it is quarantined and refused, the design needs a documented answer before it can ship |
| M3 | Does Installer.app replace a running `/usr/local/bin/mixengined` and a running `/Applications/MixLab.app` cleanly, with both still running afterwards on their old images? | With the daemon and MixLab running, install the same `.pkg` again, then `mix status` and use the window | D6 |
| M4 | Does `open -a Installer <pkg>` from a daemon started by the login item bring Installer.app to the front? And what does it answer when the daemon was started over SSH? | Start the daemon both ways and call the open | D5 |

## Design

### D1. Which copy takes this path

`mixengine_core::updates::placement` gains a third answer, `Placement::Installer`, which carries the
directory and the receipt identifier. It is asked **first**, before the AppImage check and the write
probe:

1. On macOS, ask `mixengine_platform::install::receipt_of(<daemon exe>)`. If it answers
   `dev.mixengine.cli`, the placement is `Installer`.
2. Otherwise continue with the existing order: the AppImage, then the write probe.

`receipt_of` is new in `mixengine-platform`. On macOS it runs `pkgutil --file-info <path>` and reads
the `pkgid:` line. On the other systems it answers `None`, with no error, because they have no
`.pkg` receipts. It is kept separate from `install::packaged_by`: that one answers "who removes
this file", and on macOS it deliberately answers nobody (T88e); this one answers "who installed
this copy".

The Intel Homebrew Mac, where `/usr/local/bin` is writable, is caught by step 1 and is no longer
half-updated.

### D2. The feed lists the installer

`packaging/feed.sh` adds an `installers` array to `latest.json`:

```json
"installers": [
  { "os": "macos", "arch": "aarch64", "kind": "pkg",
    "url": ".../mixlab-0.0.9-macos-universal.pkg", "size": 123, "sha256": "..." },
  { "os": "macos", "arch": "x86_64",  "kind": "pkg",
    "url": ".../mixlab-0.0.9-macos-universal.pkg", "size": 123, "sha256": "..." }
]
```

The one universal `.pkg` is listed under both architectures, as the payload already is. The
SHA-256 inside the signed document is what binds the file (T88's D3). `Feed` reads it with
`#[serde(default)]`, so a feed without it still reads, and a copy from before this reads a feed with
it and ignores it. `feed-check.sh` and `.github/scripts/test-feed.sh` learn the new array. The
comment in `feed.sh` that says *"Every payload archive, and never an installer"* changes to say
which installers are listed and why.

### D3. The protocol, added to and never changed

All of it is additive under [ADR 0019](../decisions/0019-an-added-response-member-is-optional.md).
A client from before this sees what it saw before.

- **`UpdateStatus.placement` stays `managed` on the wire** for this copy, with a sentence that is
  still true for an old client. A new tagged variant would make an old client fail to read the
  whole status.
- **`UpdateStatus.installer: Option<UpdateInstaller>`** is new, and present exactly when the
  placement is `Installer`. `UpdateInstaller { kind: "pkg", size }`. A client that sees it offers
  the installer path instead of the refusal.
- **`UpdateStatus.installed: Option<String>`** is new: the version the binary on disk reports while
  it differs from the running daemon's. It means "installed, restart to finish".
- **`update.hand_over { version }`** is a new method. It downloads, verifies and opens the package
  (D4, D5) and answers `UpdateHandedOver { version, package }`, where `package` is the verified
  file's path. The daemon keeps running.
- **`update.finish {}`** is a new method. It is the second half of `update.apply`: stop, record,
  answer, exit (D6). It answers `UpdateApplied` with `replaced` empty, because the installer did the
  replacing, and `restarting` listing what the new daemon will start again.
- `update.apply` on an `Installer` placement is refused with a sentence naming `update.hand_over`,
  as it refuses `Managed` today.

`bindings/` is regenerated (`bash packaging/bindings.sh`). [client-surface.md](../features/client-surface.md)
lists both methods, so `mix` reaches everything MixLab does.

### D4. Download and verify

`update.hand_over` refuses unless the version asked for is the one offered, the placement is
`Installer`, and the feed has an installer for this machine. It then downloads the `.pkg` into
`<home>/run/update/<version>/` with the same partial-download and resume behaviour the payload uses,
and checks its SHA-256 against the feed before anything else touches it. A mismatch deletes the file
and says so. Nothing is stopped at any point in this step.

### D5. Hand it to Installer.app

`mixengine_platform::install::open_installer(path)` is new. On macOS it runs
`/usr/bin/open -a Installer <path>` and returns once `open` has returned; it does not wait for the
installation. The other systems answer `Unsupported`, and nothing calls them.

The daemon records `update.handed_over = { version, at }` in `settings`, then answers.

If `open` fails, for example because the daemon has no graphical session (M4), the error names the
verified file and the command a person can run: `sudo installer -pkg <path> -target /`. The file is
kept for that.

M2 decides one more thing. If a daemon-fetched `.pkg` turns out to be quarantined and refused, this
design is not finished. Clearing the attribute would bypass Gatekeeper on purpose, and it needs its
own sentence in ADR 0050 before it is done.

### D6. Detect the install, then finish

While `update.handed_over` is recorded, `update.status` runs the daemon's own path with `--version`.
The file at that path is the new binary once the installer has replaced it. The reading is cached
by the file's modification time, so a status poll costs one `stat` after the first run. When the
answer equals the recorded version, `installed` carries it.

`update.finish` then does what `update.apply` does after its swap:

1. Stop everything in reverse dependency order (`stop_everything`).
2. `remember(to, stopped)`, so the new daemon's `restore_after_update` starts them again.
3. Clear `update.handed_over`, remove `<home>/run/update/<version>/`, answer, and exit.

M3 checks the assumption this relies on: a running binary replaced on disk keeps running on its old
image until it exits.

A recorded handover is also cleared when the running daemon's own version equals it (somebody
installed and restarted another way), and when a newer release is offered.

### D7. MixLab

`UpdatesSection` gains the installer branch:

1. If `installer` is present, the button reads **Update** and states the size, as today. It calls
   `update.hand_over` and shows *"Installer is open. Finish the installation there."*
2. While that message is shown, it polls `update.status` every few seconds. When `installed`
   appears, it offers **Restart to finish**.
3. **Restart to finish** calls `update.finish`, then decides whether to relaunch the window.
   `relaunch::relaunch_after_update` gains a second rule for this path: relaunch when the bundle
   this window was started from now reports a different `CFBundleShortVersionString` in its
   `Info.plist` than the running window. The path was read at start (T106), so it is still
   `/Applications/MixLab.app`.
4. After the relaunch the window finds no daemon and shows **Start**, exactly as after T88's
   update. It does not start the daemon itself.

Strings go through `i18n` in English and Vietnamese, per `writing-user-facing-text`.

### D8. `mix`

- `mix self-update`, on an `Installer` placement, shows the same offer and consent prompt, then
  calls `update.hand_over` and prints one line: the installer is open, and
  `mix self-update --finish` completes the update once it is done.
- `mix self-update --finish` calls `update.finish` and then starts the new daemon, as
  `mix self-update` does today after `update.apply`. It refuses with a sentence when `installed` is
  absent.
- `mix self-update --check` prints `installed` when it is there.

### D9. What does not change

- The `.pkg` has no scripts and gains none.
- `mixengine-elevate` and every `PrivilegedOp` are untouched. The helper moves forward because the
  `.pkg` writes it, as it does on a first install.
- `elevation.upgrade` still refuses a managed placement. `Installer` counts as managed for it.

## Testing

- **`mixengine-core`:** placement ordering with a mock receipt (receipt first, then the AppImage,
  then the probe); a feed with and without `installers`; the handover record through hand over,
  install detected, finish, and each way of clearing it.
- **`mixengine-daemon`:** `update.hand_over` against a local feed and a mock `open_installer` that
  records its call; a SHA-256 mismatch deletes the file and opens nothing; `update.finish` restores
  services on the next start. The mock platform stands in for macOS, so these run on every system.
- **`mixengine-platform`:** `receipt_of` parses `pkgutil --file-info` output held in a fixture;
  `open_installer` answers `Unsupported` off macOS.
- **`packaging`:** `feed-check.sh` rejects a feed whose macOS rows lack an installer.
- **By hand on a Mac, before release:** install v0.0.8 from its `.pkg`, point the daemon at a test
  feed (`--update-url`, `--update-key`) that offers a v0.0.8-plus build, press **Update** in MixLab,
  go through Installer.app, press **Restart to finish**, and check that every binary, the window and
  the helper report the new version and the services came back. Then run it once more, pressing
  Cancel in Installer.app, and check that nothing changed.

## Documentation, when it lands

- [features/updates.md](../features/updates.md): the `.pkg` path, and the rule ADR 0050 narrows.
- [features/client-surface.md](../features/client-surface.md): the two methods.
- The handbook's update page, in English and Vietnamese.
- `CHANGELOG.md`: from this release, a Mac that installed the `.pkg` updates from MixLab or
  `mix self-update`, after one install by hand.

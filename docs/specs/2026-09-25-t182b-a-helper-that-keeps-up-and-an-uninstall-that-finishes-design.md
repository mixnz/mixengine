---
status: approved
date: 2026-09-25
task: T182b
---

# A helper that keeps up, and an uninstall that finishes

Follows [T182](2026-09-24-t182-removing-mixlab-is-one-act-design.md). The first real Windows
uninstall found six defects. Two of them came from one gap: nothing keeps the privileged helper in
step with the product, so a machine can keep a helper too old to do what the product now asks of it,
for ever. The other four are in the uninstall itself.

**The goal is what a person goes through, and it is this table.** Every decision below exists to
produce it.

| What the person does | Windows | macOS (`.pkg`) | Linux (`.deb`, `.rpm`) |
| --- | --- | --- | --- |
| Install | runs the setup; nothing is asked; MixLab opens | Installer.app asks for the password once | App Center or `sudo apt install ./…`, once |
| First launch | **one UAC prompt** when the window's Allow dialog is accepted, for the helper, the authority and the DNS wiring together; headless, at the first `mix` command that needs an administrator | nothing more: the package placed the helper | nothing more |
| Update, helper unchanged (most releases) | **nothing is asked** | Installer.app asks once | the package manager asks once |
| Update, helper changed | one UAC prompt | the same one ask | the same one ask |
| Uninstall | Installed apps, one page, **one UAC prompt**, and nothing is left | `mix uninstall`, one ask | `mix uninstall`, one ask, then `apt remove` |

## What happened, from the daemon's log

1. **The installed helper was `0.1.0`, from 2026-09-04**, older than the version renumbering
   (`10b80b1d`) and older than T87. It does not know `helper-remove`, `audit-log-remove` or
   `helper-replace`. Each uninstall run was refused two rows and could never finish. Reinstalling
   did not help: the daemon installs a helper only when none is there (`Elevation::require_helper`),
   self-update never replaces one (`updates::apply::KEPT`), and the only way to replace it,
   `mix elevation upgrade`, needs the old helper to know `helper-replace`.
2. After the person deleted `C:\Program Files\MixEngine` by hand and reinstalled, the daemon started
   on the kept home and queued `resolver-apply`, `trust-ca-install` and `hosts-apply`. That is
   correct: they wait for a grant.
3. **`daemon.uninstall` raised its prompt, and `grant_within` flushes the whole queue.** The batch
   re-installed the NRPT rule, the certificate authority and the hosts entry that the uninstall was
   removing.
4. **Those rows were `Absent` before and present after, and `settle` answered them `Planned`.**
   Nothing counts `Planned` as unfinished, so the job said `succeeded`, `mix uninstall` exited `0`,
   and the daemon stayed up.
5. The uninstaller trusted the `0`, deleted `mix.exe`, and could not delete `mixengined.exe`. Even on
   a run that finishes, `mix` returns when the endpoint stops answering, before the daemon's process
   has exited.
6. The choices page runs `mix uninstall --dry-run --relocated` while it is being drawn. It shows
   blank for seconds, and the Uninstall button already takes clicks.

## Decisions

### D1. The helper has a version of its own

Today the helper reports the product's version (`CARGO_PKG_VERSION`, from the workspace). Two
releases' helpers then always differ, so keeping the helper in step would cost a prompt at every
update, even one that did not touch a line of it.

`mixengine-proto` gains **`privileged::HELPER_VERSION`**, one constant that both sides read.
`mixengine-elevate` reports it in every response header (`elevate-version`), in the audit log, and in
the stamp of its signed release asset. The daemon compares against it. It changes **in the same
commit that changes what goes into the helper**, and what counts as that is decided below.

**Nobody decides when to bump it; a committed fingerprint does, and it is checked the moment the
helper changes, not when a release is built.**

`crates/mixengine-elevate/helper.lock` is committed beside the code. It holds `HELPER_VERSION`, and
the fingerprint of **what the compiler actually builds into the helper**, which a hand-kept list of
directories would miss: the `elevated` modules of `mixengine-platform` and every external crate,
where a `windows-sys` bump alone changes the binary. The fingerprint has two parts:

- **the sources**: every file listed in the dep-info (`.d`) files cargo writes for the workspace
  crates in the helper's closure (`mixengine-elevate`, `mixengine-platform` with `elevated`,
  `mixengine-proto`), taken from `cargo check -p mixengine-elevate` for **three targets**
  (`x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `aarch64-apple-darwin`), with the SHA-256 of
  each file's content. Checking a target needs its standard library and nothing else: the helper's
  closure has no C build script, so all three run on any one machine;
- **the dependencies**: every external crate in that closure with its version from `Cargo.lock`.

**Compared with the last release, not with the last commit.** A person receives one release, so the
helper needs one bump per release that changes it, not one per commit. `helper.lock` therefore holds
three things: `HELPER_VERSION` as it stands, and the **version and fingerprint of the helper the
last release shipped**, which is the baseline.

`packaging/helper-lock.sh` is the one command:

- `--check` recomputes the fingerprint. It fails only when the fingerprint differs from the
  baseline **and** `HELPER_VERSION` still equals the baseline's version, with *"the helper changed
  since v<last>: run `bash packaging/helper-lock.sh --bump`"*. The first commit after a release that
  touches the helper bumps. Every later commit in the same cycle passes, since the version is already
  ahead of what was shipped;
- `--bump` sets `HELPER_VERSION` to the baseline's version plus one patch (`0.1.1` → `0.1.2`). Run
  twice in one cycle, it changes nothing the second time;
- `--release`, run by `scripts/set-version.mjs` as part of cutting a release, records the current
  version and fingerprint as the new baseline. Nobody runs it by hand.

Two branches that both touch the helper in one cycle bump to the same number and merge without a
conflict in meaning. Between two releases the helper can change more than once under one version, so
a developer's machine does not replace its helper from one commit to the next. That is the price of
one bump per release, and it touches no one who installs releases.

It is checked at three points, earliest first:

1. **At commit**, by `.githooks/pre-commit` (enabled with `git config core.hooksPath .githooks`,
   which `CLAUDE.md` and the contributing notes say to run once). The hook runs `--check` only when a
   staged file is one `helper.lock` lists, or is `Cargo.lock`, so every other commit pays nothing;
2. **In the local gate** `CLAUDE.md` lists before every commit, beside `clippy` and `fmt`;
3. **In the branch's CI**, in the lint job, as the net for anybody without the hook. That is still
   before merge, never at a release.

The fingerprint errs one way on purpose: a comment-only change to a helper file also asks for a bump,
and the price of that is one prompt in the next update.

`HELPER_VERSION` starts at `0.1.1`. The old stamps are product versions (`0.0.7` and below, and the
stray `0.1.0` from before the renumbering), so every helper installed before this compares older
than `0.1.1`, and all of them get replaced once.

### D2. One flow, in the daemon, on every system

**The helper is kept in step by the daemon, and by nothing else.** No installer and no updater has
its own hook, so there is exactly one place that decides, and it behaves the same on Windows, macOS
and Linux.

At every start, the daemon probes the installed helper as it already does
(`learn_installed_helper`, which needs no prompt) and compares its version with `HELPER_VERSION`:

| Installed helper | What the daemon does |
| --- | --- |
| same version | nothing |
| newer | nothing: a newer helper answers an older daemon at the older protocol, as T88a already arranged, and a downgrade is never installed |
| none | queues `HelperInstall`, as today: the helper beside the program installs itself at the next grant |
| older, knows `helper-replace` | queues `HelperReplace` with this release's signed helper as the candidate (T88a's path). The installed helper checks the signature and the stamp as root |
| older, does not know `helper-replace` | queues `HelperInstall`, run by the helper beside the program (D3), which copies itself over the old one |

**The helper's own operation always goes first in its batch.** The batch is run by the helper that
is installed when it starts, so an operation placed after `HelperReplace` would still be answered
by the old one. Placed first, the replacement happens before anything else is asked of the helper,
and a batch the old helper cannot read at all goes through D3.

**Queued, not prompted.** The operation joins whatever the product next asks permission for, so the
person sees one prompt, not an extra one. Two moments always ask anyway: the first launch after an
install (the authority and the DNS wiring are queued too), and an uninstall. So a helper that needs
replacing is replaced **at the latest by the next of those**. After an update that changed the
helper, the daemon also raises the prompt itself at that first start, because the person has just
asked for something.

**Where a package placed the helper as root** (the `.pkg`, the `.deb`, the `.rpm`), it placed
`HELPER_VERSION`, and the first row answers. That is the same flow reaching an answer, not a second
one.

**Where the signed candidate comes from.** The update payload carries the helper, and the feed
already publishes `mixengine-elevate-<version>-<os>-<arch>` with its `.minisig` (T88a). With D1 those
assets are named and stamped by `HELPER_VERSION`, so a release whose helper did not change
re-publishes the same helper. The daemon fetches the signature and the asset once. **Offline**, it
leaves the helper as it is and tries again at the next start. If a batch needs an operation the old
helper does not know, D3 still gets it done.

**`mix elevation upgrade` goes.** Its job is D2's fourth row, which is now automatic. The command,
the `elevation.upgrade` method, `HelperUpgrade` and `HelperUpgradeOutcome` are removed, with the
handbook's instructions for them (`permissions.md`, `updating.md`, both languages). The code
underneath stays and is what the fourth row calls. MixLab never called the method.

### D3. A helper too old to understand a batch is not the one that runs it

`mixengine_core::elevation::helper` prefers the installed copy (T85's D5) and gains one exception:
**when the helper beside the program reports `HELPER_VERSION`, and either the installed helper does
not list an operation in the batch among its `supported_ops`, or the batch installs a helper over
one that does not know `helper-replace`**, the batch runs through the one beside the program. The
second case is D2's last row: such a helper does know `helper-install`, but run by it the operation
copies its own image onto itself and answers `AlreadyDone`.

That copy gets exactly the trust a first grant on a new machine already gives it, which
`docs/architecture/security-model.md` states as a residual. It is used only when the installed copy
*cannot* do the work, never because it is merely older. An older helper that knows `helper-replace`
is always replaced through D2's signed path.

This is what reaches the `0.1.0` helper, and what lets an uninstall on such a machine remove it
instead of being refused.

**Two accounts, one helper.** Programs install per user on Windows, but the helper lives in
`C:\Program Files\MixEngine` for the whole machine. When one account uninstalls, the helper goes, and
another account that still uses MixLab finds none at its next start. That account's daemon then
queues `HelperInstall` (D2's third row) and the helper comes back at its next prompt. This is
accepted: two MixLab users on one Windows machine is rare, and the machine repairs itself without
anybody having to understand why.

### D4. The update keeps the helper beside the program current

`updates::apply` swaps every binary it ships except `mixengine-elevate` (`KEPT`), so after an update
the copy beside the program is the old one, and D2 and D3 would have nothing current to install
from. The copy beside the program is in a directory the person's account already writes, and
skipping it protects nothing: **the swap now replaces it too**. `KEPT` goes. The privileged copy is
still never touched by the swap, only by D2 through a prompt.

### D5. Formats: one with the window and one headless, per system

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| With the window | `mixlab-<v>-windows-<arch>-setup.exe`, per user, no prompt | `mixlab-<v>-macos.pkg` | `mixlab_<v>_<arch>.deb`, `mixlab-<v>.<arch>.rpm` |
| Headless | `mixengine-<v>-windows-<arch>-headless-setup.exe`, per user, no prompt | `mixengine-<v>-macos-headless.pkg` | `mixengine_<v>_<arch>.deb`, `mixengine-<v>.<arch>.rpm` |

**Removed as downloads, from v0.0.8:** the Windows zip and headless zip, the macOS archive, the Linux
tarball and the AppImage. There is no transition release. Nobody depends on those formats yet, and
a release that still published them only to announce their end would be work for no reader. The
Windows update payload stays, since it is what the per-user swap installs, but it is no longer
offered as a way to install.

**Linux beyond Debian and Fedora is not supported.** Arch, NixOS, Gentoo and the rest could run the
tarball; they now have no install path, and the handbook says so plainly rather than leaving them to
find out.

**Updates:**
- **Windows:** the per-user swap as today (T88), no prompt, with D4.
- **macOS:** the `.pkg` through Installer.app (ADR 0050).
- **Linux:** ADR 0050's path, for the `.deb` and the `.rpm`. `updates::placement::of` answers
  `Installer` for a daemon a package owns (`install::packaged_by`, which already asks `dpkg`/`rpm`).
  The feed's `installers` lists them with URL, size and SHA-256 inside the signed `latest.json`. The
  verified file is opened with `xdg-open`, which reaches App Center, GNOME Software or Fedora's
  Software, and they ask through polkit. **The terminal command is always printed as well**
  (`sudo apt install ./…deb`, `sudo dnf install ./…rpm`), because a software centre that will not
  install a local package is common enough to plan for. Nothing in MixEngine elevates. v0.0.8 ships
  this code, so a package installed at v0.0.8 is the first to update this way, to v0.0.9: the code
  that updates is the code already installed (ADR 0050's D6).

### D6. An uninstall grants only what it asked for

`daemon.uninstall` records the pending ids of the operations it enqueued (by reading the queue back
and matching each operation's wire form) and raises its prompt over **those ids only**:
`Elevation::grant_only(handle, ids)` is `grant_within` with the preflight's list filtered to `ids`.
Anything a producer queued stays where it was. A finished uninstall then clears the queue, since the
daemon is about to exit and nothing in it belongs to a home that is going.

**Whole-state operations replace each other in the queue.** `hosts-apply` and `firewall-apply`
dedupe on their name, so the uninstall's empty block *replaces* a site's pending block rather than
waiting beside it. The uninstall therefore **snapshots every pending row it is about to displace**
before it enqueues. If its grant is declined or fails, it drops its own rows and puts the snapshot
back, so a declined uninstall leaves the queue exactly as it found it.

### D7. A row that is still there after the act is a failure

After the grant, and again after the unprivileged half, every row not kept is settled from the second
reading: gone → `Removed` (or `Absent` if it was never there), scheduled → `OnRestart`, **still there →
`Failed`**, whatever the first reading said. `left_behind()` counts `Failed`, so `mix uninstall`
exits non-zero and the Windows uninstaller stops with MixLab still installed (T182's P1).

### D8. `mix uninstall` waits for the process, not the endpoint

Before the act, `mix` reads the daemon's pid from `daemon.status`. After a finished run it waits
until **that process has exited**, up to 120 s (removing a home with runtimes in it takes a while),
and exits non-zero naming the pid if it has not. The process is named by its pid **and** the moment it began (`mixengine_platform::process::started_at`, which the supervisor already uses), so a pid the OS reuses meanwhile reads as ended.
The Windows uninstaller also retries deleting `mixengined.exe` once a second for 30 s before calling
it stuck.

### D9. The choices page draws what is already known

`mix uninstall --dry-run --relocated` moves to `un.onInit`, behind the stock `Banner` plugin
(*"Checking MixLab's folders…"*). No page exists while it runs, so nothing can be clicked, and
`un.ChoicesPage` only draws from `$Relocated`.

## ADR

**ADR 0052, *The helper has its own version and follows the product through the daemon***, records
D1 to D4 and D5's formats. It amends T85's D5 (the D3 exception), T88a (a replacement no longer
waits to be asked for, and `mix elevation upgrade` goes), ADR 0049's list of downloads, and extends
ADR 0050 to the Linux packages.

## What changes

| Where | Change |
| --- | --- |
| `crates/mixengine-proto/src/privileged.rs` | `HELPER_VERSION` (D1); `elevation.upgrade`, `HelperUpgrade`, `HelperUpgradeOutcome` removed (D2); bindings regenerated |
| `crates/mixengine-elevate` | reports `HELPER_VERSION` in its header and audit lines (D1) |
| `crates/mixengine-core/src/elevation.rs` | the D3 exception in `helper`/`choose`, with its table test |
| `crates/mixengine-core/src/updates/` | `apply` without `KEPT` (D4); `placement` and the feed's `installers` for Linux packages (D5); `helper` fetched by `HELPER_VERSION` |
| `crates/mixengine-platform` | Linux `Installers::receipt_of` and `open` (D5) |
| `crates/mixengine-daemon` | the D2 table at every start; `grant_only` and D6; D7 |
| `crates/mixengine-cli` | D8's wait; `mix elevation upgrade` removed; `self-update` prints the Linux command (D5) |
| `packaging/sign.sh`, `feed.sh`, `common.sh` | the helper asset named and stamped by `HELPER_VERSION` (D1); Linux installers in the feed; no zip, tarball or AppImage downloads (D5) |
| `packaging/windows/` | the headless setup; D8's retry; D9; no zips |
| `packaging/macos/`, `packaging/linux/` | the headless `.pkg`; no archive, tarball or AppImage |
| `.github/workflows/`, `packaging/helper-lock.sh`, `.githooks/pre-commit`, `crates/mixengine-elevate/helper.lock`, `CLAUDE.md` | the fingerprint, its check at commit, in the local gate and in CI (D1); build and release jobs for the formats that remain |
| `docs/decisions/0052-…`, `docs/features/updates.md`, `docs/architecture/security-model.md`, `docs/guide/{en,vi}/{installing,updating,permissions,uninstalling}.md` | the flow above |
| `docs/roadmap/phase-9-ship.md` | T182b, split into ordered subtasks by the plan; a follow-up for stale authorities |

## Out of scope

**Stale authorities from other homes.** The machine that found this holds eleven
`MixEngine Local CA …` certificates in `LocalMachine\Root`, from earlier installs and development
homes, and each uninstall removes only its own home's. Which authorities an uninstall may claim is a
separate decision, recorded as a follow-up task.

## Testing

- Proto/elevate: the helper's header reports `HELPER_VERSION`, not the product's version.
- Fingerprint (D1): `helper-lock.sh --check` passes on a clean tree; editing a file the helper's
  dep-info lists, or bumping a crate in its closure, makes it fail with its sentence until `--bump`
  runs, and a second such edit after the bump passes; `--release` moves the baseline;
  editing a file outside the helper (the daemon, the window) leaves it passing; the pre-commit
  hook runs the check only when a staged file is in `helper.lock` or is `Cargo.lock`.
- Core: `choose` picks the helper beside the program exactly when the installed one lacks an
  operation in the batch *and* the one beside reports `HELPER_VERSION`, and in no other row (D3).
- Daemon:
  - D2's table, one test per row, against a fixture helper whose probe answers the version and
    `supported_ops` the row needs. A row that queues does not prompt, and the queued operation rides
    the next grant;
  - a batch holding a helper operation and others puts the helper operation first (D2);
  - an uninstall that displaces a site's pending `hosts-apply` and is then declined leaves the queue
    exactly as it found it, the site's block included (D6);
  - an uninstall's grant carries only its own ids, and a producer's `trust-ca-install` is still
    pending afterwards (D6);
  - a row `Absent` before and present after is `Failed`, the run is unfinished, the daemon stays up,
    `left_behind()` is true (D7).
- Updates: the swap replaces the helper beside the program and never the installed one (D4);
  `placement::of` answers `Installer` for a daemon a package owns and keeps the swap for the Windows
  per-user copy (D5).
- CLI: the daemon's pid no longer names a running process when a finished `mix uninstall` returns.
- CLI: a finished uninstall returns only after the daemon's process has gone (D8).
- By hand, added to `packaging/windows/uninstall-check.md`, with one row of the goal table per case:
  - a machine with the `0.1.0` helper: the next launch asks once and leaves the helper at
    `HELPER_VERSION`;
  - an update that did not change the helper asks nothing;
  - an uninstall with a kept home that has sites leaves no NRPT rule, authority or hosts entry, and
    no process running;
  - the uninstaller opens on a banner and then a filled page.

# 0056. MixLab stands without MixEngine, and updates itself

**Status**: Accepted. It supersedes rule 3 of
[0027](0027-the-desktop-client-lives-in-this-repository.md) (*"One installer, one updater, and both
are MixEngine's"*) for any install that carries the window, completes
[0044](0044-mixlab-is-the-product-and-mixengine-is-the-engine.md), replaces D8 of
[T106](../specs/2026-09-09-t106-one-updater-design.md), and removes the daemon's unprompted update
check that [T88](../specs/2026-09-04-t88-self-update-design.md) added.
**Date**: 2026-09-26

## Context

[ADR 0044](0044-mixlab-is-the-product-and-mixengine-is-the-engine.md) settled that MixLab is the
product and MixEngine the engine inside it. It settled it as a question of **names**, and said
nothing about **dependence**. Everything written before it still describes the window as a client
of the daemon, and everything written since has followed that description:

- The root `CLAUDE.md` opens with `# MixEngine`, describes the product as a local web development
  environment, and introduces the window as *"a second thin client over the same API"*.
- ADR 0027 rule 3 gives the only updater to the daemon: *"the daemon's own updater replaces it"*.
- T106 removed the window's own updater and left the shell's Updates pane as a signpost to the
  MixEngine tab (its D8).

**What that produces, measured on 0.0.8.** The updater lives in `mixengined`: it checks the feed at
daemon start and then at most every 24 hours (`docs/features/updates.md`), and `update.apply` is the
only thing that swaps files. The window starts the daemon only when somebody presses *Start* in the
MixEngine tab or the tray. So a person who uses MixLab for its database client, its REST client or
its terminal, and never opens MixEngine, **never receives an update and is never told one exists**.
The shell's Updates pane offers them *Open the download page* and a sentence pointing at a tab they
do not use.

**How people actually use the window.** The toolbox — `db`, `rest`, `terminal`, `tools` — is
complete without the daemon and is, for many users, the reason they installed MixLab. MixEngine
matters most to the person who works from `mix` in a terminal, and to them it already is the whole
product: the headless download ([0049](0049-a-download-is-named-after-what-it-installs.md)). For a
person using the window, MixEngine is one module among several, and an optional one.

## Decision

**MixLab is first. Nothing a MixLab user needs from MixLab itself may depend on MixEngine being
installed, running, or ever having run. MixLab updates itself.**

1. **MixEngine is an optional module of MixLab.** The toolbox and every product-level capability of
   the window — updates, Settings, sync ([0045](0045-mixlab-has-an-account-and-mixengine-does-not.md)),
   crash logging — work with `mixengined` absent or stopped. MixEngine is the centre of
   the product only for the headless distribution and the person who drives it with `mix`.

2. **The window never starts the daemon to do a job of its own.** Starting `mixengined` is
   something a person asks for in the MixEngine module or the tray, and nothing else. A MixLab
   feature that "only needs the daemon briefly" is a feature that depends on MixEngine, and rule 1
   forbids it.

3. **The updater of an install that carries the window is MixLab's, and its code is MixLab's.** It
   lives in the window's own workspace, `apps/desktop/src-tauri/`, and imports nothing from
   `crates/`. It checks the feed, downloads the payload, verifies it, swaps it into place, rolls
   back on failure and relaunches the window. Its only pane is the shell's **Settings → Updates**.
   It may check the feed on its own and announce a new version in the shell, whatever modules are
   visible; it **never installs one without the person asking**, as a click in that pane.

4. **One feed, one payload, one release.** MixLab reads the same signed `latest.json`, with the
   same public key, as `mix self-update`, and applies the same payload. The feed's schema is the
   contract between the two readers; neither gains a format of its own. What the payload replaces
   is what the install already has — ADR 0027 rule 3's *adds nothing* is kept — so an update from
   MixLab replaces the window **and** the MixEngine binaries beside it.

5. **A running daemon is coordinated with, not relied on.** When `mixengined` answers on its
   endpoint, the updater — after the payload is downloaded and verified, and not before — asks it
   to stop through the public JSON-RPC API (`daemon.shutdown`), keeps the list of services that
   shutdown reports it stopped, swaps, starts the new daemon and starts those services again. When
   no daemon answers, those steps are skipped and no daemon is started. A failed swap puts back the
   old files and, if one was running, the old daemon and its services.

6. **`mix self-update` stays, on every install.** It is the updater of the headless distribution,
   and it keeps working on an install that carries the window. The two updaters never swap at the
   same time: both take one lock before they touch a file, and a run that finds it taken says who
   holds it and stops.

7. **Per-format rules that already exist carry over to the new owner.** A copy the macOS `.pkg`
   installed is still updated through Installer.app
   ([0050](0050-a-copy-the-pkg-installed-is-updated-by-the-pkg.md)); a `.deb` or `.rpm` is still
   left to its package manager ([0053](0053-the-helper-has-its-own-version-and-follows-the-product.md)).
   What changes is who does the handing over for the window's install: MixLab, not the daemon.

8. **MixEngine never updates itself, and never asks the feed unprompted.** A headless install is
   meant to run where nothing may change under it — a shared server, and later production — and
   an update restarts the daemon and every service it supervises. So `mixengined` reads the feed
   only when a person asks: `mix self-update`, `mix self-update --check`, or `update.check` from a
   client. The check at daemon start and the 24-hour clock T88 added are removed, on every install,
   and nothing in MixEngine downloads or installs a release that nobody asked for. The helper
   following the product ([0053](0053-the-helper-has-its-own-version-and-follows-the-product.md))
   is not an update in this sense and stays: it brings the helper to the version a person already
   installed, never to a newer release.

## Consequences

**Easy.** A person who uses only the toolbox gets updates, and is told about them, like any desktop
application. The Updates pane becomes the place to update rather than a pointer to another tab.
The rule in point 1 gives every later feature a question to answer before it is built: *does this
work with MixEngine switched off?*

**Hard, and accepted.**

- **Two implementations read one feed and swap one payload.** `crates/mixengine-core/src/updates/`
  for `mix self-update`, `apps/desktop/src-tauri/` for MixLab. Keeping them in step is a cost this
  decision chooses over MixLab depending on MixEngine's code; the design spec says what holds them
  to the feed's schema and to the payload's layout.
- **Updating the daemon from outside it** is new. T88's swap runs inside `mixengined`, which stops
  its own services, records what to restore, and lets its successor restore them. MixLab has to do
  the same through the public API, and the spec decides what it records if the window itself dies
  between the stop and the restart.
- **The documents that describe the window as a client first are now wrong** and are corrected with
  this decision: the root `CLAUDE.md`, `apps/desktop/CLAUDE.md`, and `docs/features/updates.md`.
- **A headless machine is no longer told a release exists** unless somebody runs
  `mix self-update --check`. `mix status` stops showing an update line it has not been asked for,
  and the `[updates]` keys that governed the clock (`enabled`, `check_seconds`) have nothing left to
  govern; the spec decides whether they are removed or kept as accepted-and-ignored.

**What does not change.** ADR 0027 rules 1, 2, 4 and 5: the `mixengine` module still reaches the
daemon only through JSON-RPC, the toolbox never dials it, visibility is a setting, and the desktop
crate is its own workspace. No rule about elevation or the platform layer moves. `mix self-update`
works exactly as before when a person runs it.

## Alternatives considered

- **Keep the daemon as the only updater, and have the window start it to update.** What T106
  built, plus an autostart. Rejected by rule 2: it makes every MixLab user run MixEngine to keep
  MixLab current.
- **Move the updater into a crate of its own under `crates/` that both use.** One implementation
  instead of two. Rejected: the window would still depend on MixEngine's code for a capability that
  is MixLab's, which is the dependence this decision removes.
- **Show the MixEngine tab's Updates pane in the shell.** Rejected for the same reason as the first:
  that pane is a client of `update.*`, which answers only while the daemon runs.
- **Give MixLab a feed and a key of its own.** Rejected: one release produces one payload holding
  both, and two signed indexes for one artifact is two things to keep in step for nothing.

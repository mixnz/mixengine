# 0029. Every install format carries a helper to install from

**Status**: Accepted
**Date**: 2026-09-11
**Extends** [0015](0015-the-helper-installs-itself.md), whose mechanism is untouched

## Context

[ADR 0015](0015-the-helper-installs-itself.md) made `PrivilegedOp::HelperInstall {}` the one way a
privileged helper reaches a root-owned directory, and made *the copy beside the running program* the
one thing it is ever copied from. **T87** then gave `mix uninstall` a `HelperRemove {}` row, so that
nothing of ours is left behind.

Those two decisions do not compose on three of the six shipped formats, and the code has said so
since T85 without anybody reading it as a defect. `mixengine_platform::install::missing_helper_advice`
tells a macOS user to *"reinstall the .pkg to put it back"* and a Linux user to *"reinstall the
package"*, because on those two systems there is nothing else to say.

The chain, measured in the tree at `7d570f0f`:

1. **Recovery is the beside copy, and only the beside copy.** `Elevation::require_helper` runs at
   every daemon start and enqueues `HelperInstall {}` when nothing is installed *and* a helper sits
   beside `mixengined`. `mixengine_core::elevation::helper` derived that one path and no other.
2. **The `.pkg`, the `.deb` and the `.rpm` place none there.** They run as root and write the
   installed path directly, which ADR 0015 called *"an optimisation of one mechanism"* — and it is,
   right up to the moment the installed copy is removed.
3. **Both other routes are closed.** `elevation.upgrade` answers `Unavailable` before it fetches
   anything when `updates.placement()` is `Placement::Managed`, which is exactly those three
   formats; and `HelperReplace {}` is applied by the *installed* helper, which is the file that has
   just gone.
4. So `helper` answers `ElevateMissing`, `ElevationStatus::can_prompt` goes false, MixLab hides the
   Allow button, and **every privileged operation on that machine is refused for the life of the
   installation**.

MixLab reaches this by default: its uninstall ticks *keep my home*, and with that flag the daemon
does not exit. The application goes on running with its ability to reach root permanently gone.

## Decision

**A source is a list the platform answers, and every install format ships at least one entry of it.**

- `mixengine_platform::install::helper_sources(program, bundle)` returns, most trustworthy first,
  every copy of `mixengine-elevate` this system's install formats leave behind that MixEngine may
  install *from*. It is never empty: every system ends the list with the file beside the program,
  which is what the single fallback used to be.
- **Windows is unchanged.** `RequestExecutionLevel user` already forced a copy beside `mixengined`.
- **Linux gains a copy at `/usr/bin/mixengine-elevate`** in the `.deb` and the `.rpm`. That is
  `MIX_INSTALL_LINUX` — the directory `mixengined` is in — so this system needs no candidate the
  beside rule does not already produce, and the directory is root-owned on every Linux.
- **macOS gains a copy inside `MixLab.app/Contents/Resources/`** in the `.pkg`, composed from
  T107's `window_dirs` and preferred over the beside copy.
- `choose` takes the sources as a **closure**, and does not build the list at all when there is an
  installed helper to prefer. `helper` is on the path of every `mix status` and every poll a window
  makes, and this is what keeps that reading at the two syscalls it costs today.
- **The queue asks for the installation at a producer and not only at a daemon start.** The four
  `require_*` methods put `HelperInstall {}` in front of their own row when this machine has no
  installed helper and does ship a source — at the enqueue rather than at the top of the producer,
  so a machine that already agrees is still asked for nothing. `require_helper` alone would have
  needed a restart, and a `keep_home` uninstall does not restart the daemon.
- **`HelperInstall {}` still carries no fields.** What is copied is still `std::env::current_exe()`
  and where it goes is still a constant compiled into that binary. This decision changes where the
  image an elevation prompt is handed is allowed to have come from, and nothing about the operation.

## Consequences

- **One story on six formats, which is what ADR 0015 set out to have.** What a machine ends up
  running as root does not depend on how MixEngine arrived on it — and now neither does whether it
  can put that file back.
- **`mix uninstall` stops being a one-way door**, without keeping anything back: it removes the
  installed helper exactly as it did, and the machine installs another from a file that was already
  there. The recovery is the prompt that already exists, so no API method was added and no client
  gained a capability `mix` does not have.
- **macOS gains a user-replaceable source, and that is a cost rather than a wash.** `/Applications`
  is `drwxrwxr-x root:admin` and the first account on a Mac is in `admin`, so that account can
  replace the whole bundle — the `.pkg` writes the bundle's *contents* as root, so this is a
  replacement of the application rather than a patch of one file, but the outcome is the same. It is
  reachable **only on a machine with no installed helper**, because an installed one is preferred and
  an installed one that is writable is refused outright ([ADR 0015](0015-the-helper-installs-itself.md)'s
  D5, unchanged). That is the residual
  [../architecture/security-model.md](../architecture/security-model.md) already states for Windows,
  the portable archives, the AppImage and every development tree; what changed is that macOS is now
  in the list. **Linux gains none**: `/usr/bin` is root's.
- The daemon warns, once per row it asks for, when the source it would install from is not an
  administrator's — `mixengine_core::elevation::source_trust`, read there and deliberately not in
  `helper`.
- Six tests in `crates/mixengine-daemon/src/elevation.rs` gained an installed helper in their
  fixture. They are about what a *producer* asks for, and the fixture they shared describes a machine
  with nothing installed — on which every producer now asks for two things. Saying which machine each
  test means is the better half of that change.
- **`mix uninstall` still removes a file `dpkg` and `rpm` believe they own.** Untouched here and
  recorded as **T88e**: the `.deb`, the `.rpm` and the `.pkg` place the installed copy themselves, so
  the file T87 removes is the package's. The answer is a packaging decision about who places it, and
  folding it in would have made this task about two things.

## Alternatives considered

- **A bootstrap in `/Library/PrivilegedHelperTools` under a second name.** The most tamper-resistant
  option on macOS — root-only, where the admin-writable bundle is not. Refused because a source has
  to satisfy two conditions and this one satisfies only the first: it survives `mix uninstall`, and
  it also survives somebody dragging `MixLab.app` to the Trash, sitting for ever in the directory the
  uninstall has just reported cleaning.
- **`/usr/local/bin/mixengine-elevate` on macOS**, for symmetry with Linux. Refused on
  [ADR 0015](0015-the-helper-installs-itself.md)'s own fact 2: Homebrew on an Intel Mac takes
  ownership of `/usr/local` for the installing user, so this is the *worst* available directory on
  that machine rather than a neutral one. The bundle's contents are the installer's, written as root.
- **Keeping the helper at uninstall where a package manager placed it.** Principled on Linux, and it
  would fix T88e as well. Refused as the answer here because macOS has no `.pkg` uninstaller to hand
  the file to, so it would leave that system with the choice this ADR is about and a second behaviour
  besides. T88e is where the ownership question belongs.
- **Fetching a signed helper over the network** — generalising `elevation.upgrade` into a repair.
  Every piece exists: T88a stages a candidate, verifies minisign twice, and smoke-tests it. Refused
  because the staged candidate lives in `<home>/run/helper/`, which the user can write: elevating it
  would hand a compromised daemon *arbitrary root behind one Allow click* on the two systems that do
  not have that today, and the daemon's own verification is not a boundary against the daemon. It is
  also useless on an offline machine, which
  [../features/updates.md](../features/updates.md) refuses to make a daemon start depend on.
- **Enqueuing the installation on every `enqueue` rather than at the four producers.** Simpler to
  state and wrong in one place that matters: `enqueue` is also how the uninstall's rows and the
  helper's own two get in, and a batch that installed a helper in order to remove it is work done and
  undone in front of somebody reading the list.

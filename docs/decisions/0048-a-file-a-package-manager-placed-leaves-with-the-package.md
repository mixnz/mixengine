# 0048. A file a package manager placed leaves with the package

**Status**: Accepted — extends [ADR 0029](0029-every-install-format-carries-a-helper-to-install-from.md),
answering the ownership question its *Alternatives considered* left to roadmap task T88e
**Date**: 2026-09-22

## Context

The `.deb` and the `.rpm` write `mixengine-elevate` to the installed path themselves, so a packaged
machine's first run asks for nothing ([the T85 design](../specs/2026-09-04-t85-installers-design.md), D3).
`mix uninstall` then removed that file with `HelperRemove {}`, and the package database went on
describing a file that was gone: `dpkg --verify` and `rpm -V` report it missing from then on.

[The T87 design](../specs/2026-09-04-t87-uninstall-design.md) had already drawn the line for the
program itself: `mix`, `mixengined` and `mixengine-shim` leave the way they came. The helper a
package wrote was the one exception.

ADR 0029 considered keeping it and did not, because macOS has no `.pkg` uninstaller to hand the file
to.

## Decision

1. **What a package manager installed, the package manager removes.** Before `mix uninstall` plans
   to remove the helper, it asks the system which package owns it
   (`mixengine_platform::install::packaged_by`). A helper a package owns is reported as
   `Removal::Kept`, naming the package and no command, and is never enqueued.
2. **Linux asks `dpkg-query -S`, then `rpm -qf`.** A database that is missing, fails, or does not
   answer within five seconds counts as "no package", and the helper is removed as before.
3. **macOS answers "no package", and keeps removing it.** Nothing else ever will: macOS has no
   `.pkg` uninstaller, and nothing on it reads a receipt back to find a file missing. This is the
   same rule as 1, not a second one: the helper is kept where a package manager exists to remove it.
4. **Windows is unchanged.** Its installer is per-user and never places the helper.

## Consequences

- A packaged Linux machine keeps a root-owned helper after `mix uninstall` until the package is
  removed. The uninstall list says so, and the package's own removal takes it.
- On such a machine, T88d's way back is not needed: the installed helper never went.
- One or two short process spawns per uninstall plan, on Linux only.

## Alternatives considered

- **Ship only the source in the packages, and let `HelperInstall {}` place the installed copy at
  first run.** Every file would be MixEngine's to remove, at the cost of an elevation prompt on
  every packaged machine's first run and a change to three packaging formats.
- **Ask `pkgutil --file-info` on macOS and keep the file there too.** It would leave a root helper
  on a system with no way to remove it except by hand.
- **Let `mixengine-elevate` refuse to remove a package-owned file.** Removing its own file is not a
  privilege risk, and it would put a package-database query inside the process running as root.

---
status: approved
date: 2026-09-22
task: T88e
---

# T88e: A file a package placed leaves with the package

Follow-up to [T88d](2026-09-11-t88d-a-helper-a-machine-can-reinstall-design.md) and
[T87](2026-09-04-t87-uninstall-design.md), phase 9. 2026-09-22.

## The case

The `.deb` and the `.rpm` write `mixengine-elevate` to the installed path,
`/usr/local/libexec/mixengine/mixengine-elevate`, so that `HelperInstall {}` is already done on a
packaged machine and its first run asks for nothing (T85, D3). The `.pkg` does the same at
`/Library/PrivilegedHelperTools/dev.mixengine.elevate`.

`mix uninstall` lists that file as `PrivilegedHelper` and removes it with `HelperRemove {}`
(T87, D6). On a packaged Linux machine, that file belongs to the package:

- `dpkg --verify mixengine` and `rpm -V mixengine` report it missing from then on.
- The package still says it is installed, and still owns a file that is not there.
- The file comes back only if the package is reinstalled, or if `HelperInstall {}` copies it from
  the source T88d ships beside `mixengined`.

T87 already drew this line for the program itself: `mix`, `mixengined` and `mixengine-shim`
"arrived through an installer or a zip and leave the way they came" (T87, Scope, Out). A helper
the package placed is part of what the package installed. `mix uninstall` removing it is the one
exception to T87's own rule.

[ADR 0029](../decisions/0029-every-install-format-carries-a-helper-to-install-from.md) considered
keeping the file and left the decision to this task. Its concern was macOS, which has no `.pkg`
uninstaller to hand the file to.

## Principle

**What a package manager installed, the package manager removes.** `mix uninstall` removes what
MixEngine wrote. It asks the system who owns the helper before it plans to remove it, and a helper
a package owns is reported as kept, with the reason.

## D1. Linux asks the package database

`mixengine_platform::install` gains one question:

```rust
/// The package that owns `path`, when the system's package database says one does.
pub fn packaged_by(path: &Path) -> Option<String>
```

- **Linux** runs `dpkg-query -S <path>`, then `rpm -qf <path>`, by absolute path
  (`/usr/bin/dpkg-query`, `/usr/bin/rpm`). The first one that exits 0 names the package: the text
  before `: ` for dpkg, the first line for rpm. A tool that is missing, fails, or times out after
  five seconds counts as "no package". Both programs are readable by an ordinary account, so the
  daemon asks, not the helper.
- **macOS and Windows** answer `None`. See D2 for why macOS does not ask `pkgutil`.

Per-OS process calls live in `mixengine-platform`, as every OS call does. `Placement::Managed`'s
rule holds too: the answer names a package, never a command to run.

**Why not infer it from `Placement::Managed`.** A `mixengined` in a directory the user cannot write
also describes an AppImage, and there `HelperInstall {}` placed the helper, so MixEngine owns it.
Only the package database knows who wrote this one file.

## D2. macOS keeps removing it

On macOS, `mix uninstall` removes the helper as it does today, `.pkg` or not:

- **Nothing else ever will.** macOS has no `.pkg` uninstaller. `mix`, `mixengined` and
  `MixLab.app` go when a person deletes them, but a root-owned file in
  `/Library/PrivilegedHelperTools` is the one leftover a person is least likely to find, and the
  most sensitive one to leave.
- **Nothing on macOS reads the receipt back.** No system tool checks that a `.pkg` receipt's files
  are still there, so the Linux harm (a package database describing a missing file) does not
  happen.
- **T88d already covers the way back.** The source copy inside `MixLab.app` lets
  `HelperInstall {}` put the helper back.

This is the second behaviour ADR 0029 was wary of. It follows from one rule, not two: the helper
is kept where a package manager exists to remove it, and removed where none does.

## D3. The row says it is kept

In `uninstall::inventory::privileged_helper`, a helper that is there and `packaged_by` names a
package becomes:

```rust
Removal::Kept {
    because: format!("it came with the {package} package, and removing that package removes it"),
}
```

- A kept row is not enqueued, so the batch carries no `HelperRemove {}`, and the `mixengine`
  directory under `/usr/local/libexec` stays with the file.
- `AuditLogRemove {}` still runs. The helper that applies it is the one the package left.
- `Kept` is not a failure, so `mix uninstall`'s exit code does not change (`left_behind` counts
  only `Failed`).
- `daemon.uninstall_plan` and `daemon.uninstall` both build the row through the same function, so
  the plan and the act say the same thing.

`because` is shown by `mix` and by MixLab without change, so it is written as a sentence for the
person reading the list. It names the package and no command, following `Placement::Managed`.

## D4. An ADR records the ownership rule

A new ADR, *A file a package manager placed leaves with the package*, extends ADR 0029 without
editing it. It records D1's rule, D2's macOS exception and why it is the same rule, and the
alternative below.

## Cost

- One or two short process spawns per uninstall plan, on Linux only.
- A packaged Linux machine keeps a root-owned helper after `mix uninstall` until the package is
  removed. That is what the package installed, and the list says so.

## Alternatives not taken

- **Ship only the source in the packages, and let `HelperInstall {}` place the installed copy at
  first run.** Every file would then be MixEngine's to remove. It costs every packaged machine an
  elevation prompt on its first run, which T85 D3 exists to avoid, and it changes three packaging
  formats for a problem that is only about the uninstall list.
- **`pkgutil --file-info` on macOS, and keep the file there too.** It would describe the receipt
  truthfully and leave a root helper on a system with no way to remove it except by hand (D2).
- **Keep it on every system and never remove a packaged helper.** The same as the previous one on
  macOS.
- **Make `mixengine-elevate` refuse to remove a package-owned file.** The helper validates what it
  is asked to do, but removing its own file is not a privilege risk, and it would need the package
  database from a process running as root. The daemon's plan is the right place.

## How it is proven

- **`mixengine-platform` (Linux):** the parsers for `dpkg-query -S` and `rpm -qf` output, tested
  on real output lines, including "no path found" and "is not owned by any package".
- **`mixengine-daemon` `uninstall/inventory.rs`:** the row as a pure function of "is it there" and
  "who owns it": absent → `Absent`, there and unowned → `Planned`, there and owned → `Kept` with
  the package named. A kept row adds no `HelperRemove {}` to the batch.
- **By hand, in WSL:** install the built `.deb` and run `mix uninstall --dry-run` against a sandbox
  home: the row reads kept, naming the package. A real run is not part of the check, because its
  elevation prompt needs a polkit agent WSL does not have, and the plan already proves nothing is
  enqueued for a kept row. The CI `system` job's round trip runs from a `cargo build`, where no
  package owns the helper, so it keeps proving the `Removed` case.

## What this does not do

- It does not remove the package, or tell a person how to. That is the package manager's, and
  `Placement::Managed` already refuses to guess its command.
- It does not change the `.pkg`, the `.deb` or the `.rpm`.
- It does not add a CI job that installs the `.deb`. Nothing in CI installs a Linux package today.

## Settled before approval

1. **macOS keeps removing the helper** (D2): nothing else will ever remove it.
2. **A new ADR** (D4): the task changes what `mix uninstall` promises, and ADR 0029 left the
   question open.

# T88d — A privileged helper the machine can put back

**Date**: 2026-09-11
**Roadmap**: phase 9, `T88d`, ordered immediately after
[T88a](../../../.claude/roadmap/phase-9-ship.md) and lettered after `T88c` because `T88b` and `T88c`
are taken.
**Decision record**: ADR 0029, written with this task.

---

## The problem

`mix uninstall` — and the same button in MixLab's Settings — removes the privileged helper from the
directory only an administrator can write. On four of the six shipped formats the machine puts it
back by itself at the next daemon start. On the other two it cannot, and the only way back is to run
the installer again.

The path, verified in the tree at `7d570f0f`:

1. `Uninstall::operation` maps `ResidueId::PrivilegedHelper` to `PrivilegedOp::HelperRemove {}`
   (`crates/mixengine-daemon/src/uninstall.rs`), which deletes
   `/Library/PrivilegedHelperTools/dev.mixengine.elevate` on macOS and
   `/usr/local/libexec/mixengine/mixengine-elevate` on Linux.
2. Recovery is `Elevation::require_helper`, called at every daemon start: with nothing installed it
   enqueues `HelperInstall {}` **only when a copy of the helper sits beside `mixengined`**.
3. The `.pkg`, the `.deb` and the `.rpm` deliberately ship **one** copy, at the installed path, and
   none beside the daemon (`packaging/macos/build.sh`, `packaging/linux/build-deb.sh`,
   `packaging/linux/mixengine.spec.in`). So step 2 finds nothing.
4. The second recovery route is closed twice over. `elevation.upgrade` returns `Unavailable` before
   it fetches anything when `updates.placement()` is `Placement::Managed` — which is exactly those
   three formats — and `HelperReplace {}` is applied *by the installed helper*, which is the file
   that has just been removed.
5. `mixengine_core::elevation::helper` therefore answers `Error::ElevateMissing`,
   `ElevationStatus::can_prompt` goes false, and MixLab hides the Allow button. Every privileged
   operation — the trust store, the resolver, the port grant, the firewall, the hosts block — is
   refused for the life of the installation.

None of this is a surprise to the code: `mixengine_platform::install::missing_helper_advice` says
*"reinstall the .pkg to put it back"* on macOS and *"reinstall the package to put it back"* on
Linux, and MixLab's `ElevationDialog` documents the dead end in its own doc comment. It is a
deliberate limitation of T85, and this task removes it.

It matters more than the sentence suggests because **MixLab's uninstall defaults to `keep_home:
true`** (`UninstallSection.tsx`), and with that flag the daemon does not exit: the application keeps
running, the home is intact, and only the ability to reach root is gone.

## What this task does not do

- **It does not change `PrivilegedOp`.** `HelperInstall {}` still carries no fields and still copies
  `std::env::current_exe()` to a path compiled into the elevated binary. ADR 0015's refusal of
  `HelperInstall { source }` stands untouched. Nothing in `mixengine-proto` changes, so no bindings
  are regenerated and no client is versioned against a new shape.
- **It adds no API method**, and therefore opens no gap between `mix` and MixLab. The recovery rides
  the queue and the prompt that already exist.
- **It does not make `mix uninstall` keep the helper.** Removing it stays correct; what changes is
  that the machine can put it back.
- **It does not stop `mix uninstall` deleting a file the system package manager owns.** That is a
  real defect — on a `.deb`, `/usr/local/libexec/mixengine/mixengine-elevate` belongs to `dpkg` and
  removing it behind the package manager's back leaves its database describing a file that is gone.
  It is recorded as a follow-up (`T88e`) and deliberately not fixed here, because the fix is a
  packaging decision about who places the installed copy and it would double this task's surface.
- **It does not touch the network.** No fetch, no feed, no signature: everything this needs is
  already on the machine or is not.

---

## Design

### D1 — The helper is resolved from a list of candidates, not from one fallback

`mixengine_core::elevation::helper` today takes the running program's path and the installed path,
and derives exactly one fallback: the file beside the program. It becomes:

```rust
pub fn helper(program: &Path, installed: Option<&Path>) -> Result<PathBuf>
```

— same signature, different body. The fallback is no longer computed here; it is asked for:

```rust
// mixengine_platform::install
pub fn helper_sources(program: &Path, bundle: &str) -> Vec<PathBuf>
```

which returns, in preference order, every place **this operating system's install formats** put a
copy of `mixengine-elevate` that MixEngine may install *from*. The list names files rather than
directories, is authored most-trustworthy-first, and is never empty: every system answers at least
the file beside the program, which is what today's fallback is.

**Two arguments and not one**, on `application_file_name`'s precedent and for its reason: the window
bundle's name is not derivable from anything the platform crate holds — `mixengine_core::window`
declares `BUNDLE`, and `mixengine-core` is the caller. Windows and Linux ignore it.

`choose` — the table that is already separated so it can be unit-tested over facts rather than over
a filesystem — takes the sources as facts rather than as paths:

```rust
pub(crate) fn choose(
    installed: Option<(PathBuf, Trust)>,
    sources: impl FnOnce() -> Vec<(PathBuf, bool)>,   // path, and whether it exists
) -> Result<PathBuf>
```

| installed | sources | answer |
| --- | --- | --- |
| present, administrator's | **not consulted** | the installed copy |
| present, writable by an ordinary account | **not consulted** | `ElevateUntrusted` — refused, never downgraded |
| present, owner unreadable | **not consulted** | `ElevateUntrusted` |
| absent | at least one exists | the first that exists, in the platform's order |
| absent | none exists | `ElevateMissing`, naming the platform's first entry |

The first three rows are today's behaviour, unchanged. The closure is what makes D7's laziness a
property a test can hold rather than a comment.

### D2 — Where each system's sources are

| OS | installed copy | sources, in order |
| --- | --- | --- |
| Windows | `%ProgramFiles%\MixEngine\mixengine-elevate.exe` | beside the program (`%LOCALAPPDATA%\Programs\MixEngine`) — **unchanged** |
| Linux | `/usr/local/libexec/mixengine/mixengine-elevate` | beside the program — which is `/usr/bin` for a `.deb`/`.rpm`, and the AppDir/tarball directory otherwise |
| macOS | `/Library/PrivilegedHelperTools/dev.mixengine.elevate` | `<MixLab.app>/Contents/Resources/mixengine-elevate`, then beside the program |

**Linux needs no new candidate.** `/usr/bin` is `packaging/common.sh`'s `MIX_INSTALL_LINUX` — the
directory `mixengined` itself is installed into — so a `.deb` that ships one more file there is
found by the fallback that already exists. Linux's whole share of this task is two packaging lines
and their payload assertions.

**macOS needs one.** Its `.pkg` splits the install: four command-line binaries into `/usr/local/bin`
and `MixLab.app` into `/Applications`. The daemon already knows how to find the second — T107's
`window_dirs`, which answers `/Applications` for an installed daemon and nothing for any other — so
the new candidate reuses that lookup and adds no new knowledge about this machine.

### D3 — Why the macOS source is inside the application bundle

A source has to satisfy two conditions at once, and only one location on macOS does:

1. **It must survive `mix uninstall`**, or it is not a recovery.
2. **It must not survive removing the product**, or it is residue — and `T87`'s promise is that
   nothing of ours is left behind.

- `/Library/PrivilegedHelperTools/dev.mixengine.elevate.bootstrap` — root-owned, the most
  tamper-resistant of the three, and it fails condition 2 outright: a person who drags `MixLab.app`
  to the Trash leaves it there for ever, in the directory the uninstall has just reported cleaning.
- `/usr/local/bin/mixengine-elevate` — beside the other three binaries, and the directory
  [ADR 0015](../../../.claude/decisions/0015-the-helper-installs-itself.md) refuses by name:
  Homebrew on an Intel Mac takes ownership of `/usr/local` for the installing user.
- `<MixLab.app>/Contents/Resources/mixengine-elevate` — satisfies both. It is one of the
  application's own files, in the same category as `/usr/local/bin/mix`, which `mix uninstall`
  already does not touch and never has.

The bundle is what the person removes when they remove MixEngine, so the source goes with it.

### D4 — The queue gains the row when something needs it, not only at a daemon start

`Elevation::require_helper` runs at daemon start and nowhere else. After an uninstall with
`keep_home: true` the daemon stays up, so a person who kept using MixEngine would meet the refusal
until they restarted it — a recovery that needs a restart to become visible is not one MixLab can
offer.

One rule, in `Elevation::enqueue`:

> **When something is put in the queue and this machine has no installed helper but does ship a
> source, `HelperInstall {}` goes in first.**

Cost: two `stat` calls on a path that is rare and already read at start. `enqueue` is called when a
site is created, when the authority is generated, when a port grant is needed — never in a loop.

`Uninstall` must not trip it: its own rows would otherwise drag a helper installation into the batch
that is removing one. It therefore enqueues through a second door that does not apply the rule, and
that door exists for it alone.

### D5 — An uninstall drops a helper installation that is already waiting

Independently of D4, a machine that started this morning has `HelperInstall {}` in its queue from
`require_helper`. An uninstall started now would produce a batch that installs the helper and then
removes it — the right end state, reached by doing and undoing work in front of a person reading the
list.

`Uninstall::apply` therefore discards any pending `HelperInstall {}` and `HelperReplace {}` before it
enqueues `HelperRemove {}`. `mixengine_core::elevation::discard` is the existing mechanism.

### D6 — A source that an ordinary account can write is used, and said out loud

**The platform's order is the preference order and nothing re-sorts it.** Each system's list is
authored most-trustworthy-first — that is a fact about where installers put files, known when the
list is written, and a sort at run time would only ever agree with it. What the run time does add is
one reading: when a source is chosen, `trust_of` is asked about it once, and a source that is not an
administrator's is used and **logged as a warning naming the file**.

A reading and not a refusal, deliberately. Refusing a writable source would refuse the portable
archive, the AppImage and every development tree, which is where three of the six formats live.

Using it is not a new position. On Windows, on the portable archives, on the AppImage and in every
development tree, the source beside the program is user-writable today, and
`.claude/architecture/security-model.md` already states the residual that follows: *on a machine
where nothing is installed yet, the binary the first prompt elevates is the copy beside the daemon,
so malware that replaced it before first run gets root once, and is then installed as the permanent
helper.*

What changes is **where** that residual applies, and the change is not symmetric:

- **Linux gains none.** `/usr/bin` is root-owned on every Linux, so the new source cannot be
  rewritten by the account MixEngine runs as.
- **macOS gains one.** `/Applications` is `drwxrwxr-x root:admin` and the first account on a Mac is
  in `admin`, so that account can replace the whole bundle without authenticating — and with it the
  source. It cannot write *inside* the bundle, whose contents the `.pkg` installs as root, so this
  is a replacement of the application rather than a patch of one file; but the outcome is the same
  and it is written down rather than argued away.

This is stated in ADR 0029 and added to the security model's residual list. It is bounded by the
same condition as the existing one: it can only be reached on a machine with **no** installed
helper, because an installed one is preferred and an installed one that is writable is refused
outright.

### D7 — `trust_of` stays off the ordinary path

`helper` is called by `elevation.status`, by `reason` and by `preflight` — that is, by every
`mix status` and by every poll MixLab makes. `trust_of` is four ownership reads, and on Windows they
are real API calls.

So `choose` is **lazy**: the source list is not built, not stat-ed and not trust-read when an
installed helper is present. A machine in the ordinary state pays exactly what it pays today — one
`is_file` and one `trust_of` on the installed copy. The closure in D1's signature is what carries
that, and test 7 holds it by passing one that panics.

### D8 — The advice is rewritten

`missing_helper_advice` currently tells a macOS or Linux user to reinstall. After this task that is
no longer the first answer, and on the formats that carry a source it is not an answer at all. Each
of the three implementations is rewritten to say what this machine actually has: where the source
should be, and that granting the next elevation prompt is what puts the helper back. The daemon's
`error.rs` already hangs it off `ElevateMissing` as a hint, and that stays.

---

## Components and their boundaries

| Unit | Changes | Depends on |
| --- | --- | --- |
| `mixengine-platform::install` | new `helper_sources(program, bundle) -> Vec<PathBuf>`; three per-OS implementations; `missing_helper_advice` rewritten ×3 | the per-OS constants it already holds, `window_dirs` |
| `mixengine-core::elevation` | `choose` takes the sources as a closure over facts; `helper` asks the platform for them and passes `window::BUNDLE`; the chosen source's trust is read once, to warn | `mixengine-platform`, `mixengine_core::window` |
| `mixengine-daemon::elevation` | `enqueue` applies D4; a second door for the uninstall | `mixengine-core::elevation` |
| `mixengine-daemon::uninstall` | D5: discard pending installs first; enqueue through the second door | `Elevation` |
| `packaging/linux/build-deb.sh`, `mixengine.spec.in` | ship `/usr/bin/mixengine-elevate`; assert it in the payload check | — |
| `packaging/macos/build.sh` | ship `<MixLab.app>/Contents/Resources/mixengine-elevate`; assert it in the payload check | — |
| `packaging/macos/probe.sh` | assert the source is present after an install | — |
| docs | ADR 0029; `security-model.md` residual; a pointer on ADR 0015; roadmap `T88d` and follow-up `T88e` | — |

No client changes. No `mixengine-proto` changes. No `bindings/` regeneration.

---

## Data flow

The recovery, end to end, on a `.pkg` install:

1. A person presses Uninstall in MixLab with *keep my home* ticked. The batch removes the hosts
   block, the resolver wiring, the port access, the trust anchor, the firewall plan, the helper and
   the audit log. The daemon stays up.
2. They keep using MixEngine and create a site with HTTPS. Something calls `Elevation::enqueue`.
3. D4 fires: no installed helper, and `<MixLab.app>/Contents/Resources/mixengine-elevate` exists.
   `HelperInstall {}` goes into the queue ahead of the caller's own operation.
4. `elevation.status` now reports `can_prompt: true` — `choose` found a source — and `pending`
   carries the helper row with the sentence `PrivilegedOp::describe` already writes for it.
   MixLab's `ElevationDialog` renders both rows and shows Allow.
5. The person allows. `Host::elevation().run()` raises the prompt over the **source**, because that
   is what `choose` answered. The elevated process applies `HelperInstall {}` — copying its own
   image to `/Library/PrivilegedHelperTools/dev.mixengine.elevate` — and then the rest of the batch.
6. `may_have_changed_the_helper` is true for that batch, so the daemon re-runs its handshake and
   learns the installed helper's version. Every later prompt runs the installed copy again.

---

## Error handling

- **No source and no installed helper.** `ElevateMissing`, with D8's rewritten advice as the hint.
  This is a `cargo` tree where the helper was not built, or a machine somebody has taken the product
  apart on. Nothing else changes: the daemon starts, supervises every service, and refuses only the
  privileged operations.
- **A source exists but will not run.** The prompt is raised and the elevated process fails or the
  operating system refuses the image. `flush` records the outcome as it does for any batch; the
  queue keeps its rows. There is no smoke test in front of it, unlike `elevation.upgrade`'s staged
  candidate: that one runs a binary fetched from the network, this one runs a file that shipped with
  the product and that the same person's installer placed.
- **An installed helper that is not an administrator's.** Unchanged: refused, never downgraded to a
  source. D1's table keeps that row first.
- **A batch that both installs and removes the helper.** Prevented by D5 for the ordinary case, and
  harmless if it is ever reached: the operations are applied in queue order, so the removal is last.

---

## Testing

Every test below is stated as the fact it holds, because that is what it is for.

**`mixengine-core`, over facts rather than a filesystem** (the reason `choose` is a separate
function):

1. An installed helper that is an administrator's wins over every source.
2. An installed helper that is writable is refused even when a good source exists.
3. With nothing installed, the first source that exists is chosen.
4. With nothing installed, a source that does not exist is skipped for one that does.
5. With nothing installed and every source absent, the error names the platform's first entry.
6. `helper` on a machine with no installed helper and no source beside the program still answers
   `ElevateMissing` — the shape today's callers already handle.
7. **`choose` does not build the source list at all when an installed helper is present** — D7. Held
   by passing a closure that panics.

**`mixengine-platform`**, per OS and behind `cfg`:

8. Windows answers exactly one source, beside the program.
9. Linux answers exactly one source, beside the program.
10. macOS answers the bundle source before the beside source for an installed daemon, and only the
    beside source for one that is not installed — the `window_dirs` guard.
11. Each `missing_helper_advice` names the place this system's source belongs.

**`mixengine-daemon`**:

12. Enqueuing anything on a machine with no installed helper and a source present puts
    `HelperInstall {}` in the queue as well.
13. Enqueuing on a machine with an installed helper puts nothing extra in the queue.
14. Enqueuing on a machine with no installed helper and no source puts nothing extra in the queue —
    there is nothing to install from, and a row that can never be applied is worse than a refusal.
15. The uninstall's own rows do not put a helper installation in the batch.
16. An uninstall started with `HelperInstall {}` already waiting discards it before enqueuing
    `HelperRemove {}`.

**Packaging**, in the scripts themselves, where the existing payload assertions already live:

17. The `.deb` and the `.rpm` contain `/usr/bin/mixengine-elevate`.
18. The `.pkg` contains `Applications/MixLab.app/Contents/Resources/mixengine-elevate`.
19. `packaging/macos/probe.sh` finds the source after installing the package.

**Cross-OS**, per this repository's standing rule and this machine's limitation: `clippy` on Windows
compiles neither `linux/` nor `macos/`, and most of this change is in those two directories. The
gate is `clippy` under WSL for Linux, `cargo check --target aarch64-apple-darwin` and
`--target x86_64-apple-darwin` for macOS, and CI for everything else.

---

## Risks

| Risk | Judgement |
| --- | --- |
| macOS gains a user-replaceable source | Accepted, bounded to a machine with no installed helper, stated in ADR 0029 and the security model. Linux gains nothing of the kind. |
| `trust_of` on every `mix status` | Prevented by D7's laziness, and asserted by test 7. |
| A batch that installs and removes the helper | Prevented by D5, harmless if reached. |
| A dropped `HelperInstall` row comes back | Intended, and documented: without a helper nothing can be granted at all. |
| Version skew between source and daemon | Cannot arise on the three managed formats, where `self-update` refuses to touch the binaries; handled elsewhere by T88a's `upgrade_sentence` for the rest. |
| The AppImage's source is on a temporary mount | Already solved: `packaging/linux/AppRun` extracts to a version-keyed cache before running anything, for exactly this reason. |
| A bigger `.deb`/`.rpm`/`.pkg` | A few megabytes against a product that downloads runtimes. |

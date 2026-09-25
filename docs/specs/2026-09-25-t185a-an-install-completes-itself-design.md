---
status: implemented
date: 2026-09-25
task: T185a
---

# An install completes itself from its own payload

Follows [T185](2026-09-25-t185-a-bin-that-weighs-almost-nothing-design.md). The decision is
[ADR 0054](../decisions/0054-an-install-completes-itself-from-its-own-payload.md); this is how it is
built.

**The goal:** a Windows install that updates itself onto a release carrying `mixengine-trampoline`
has trampolines in `bin\` from the first start of the new daemon. A headless install stays headless.
An uninstall run by an `uninstall.exe` older than the trampoline still leaves nothing behind.

## What there is today

- `updates::apply::stage` unpacks the payload into `cache/<STAGING_DIR>/<version>/` with
  `Installer::install`, which puts the archive's tree there as it is. The Windows zip has one
  top-level `mixengine/` directory. The feed's `provides` map is not written to disk.
- `updates::apply::swap` replaces the names the install has and reports the others as `kept`.
- After a swap the staging directory is never removed. Only the installer path (`forget`) removes
  its own.
- The daemon refreshes `bin/` at `main.rs` `shims.refresh()`, well before
  `Updates::restore_after_update` reads and clears the `APPLIED` record.
- Since T185, `shims::source` falls back to the shim when no trampoline is beside `mixengined`.

## Design

### D1. The list

`mixengine_core::updates::COMPLETABLE: &[&str] = &[shims::TRAMPOLINE]`. Names without the platform
suffix, as `provides` spells them. A test asserts `mixlab` (the window's name in `packaging`) is not
on it.

### D2. The completion step, in core

```rust
pub struct Completed {
    /// Names copied in by this call.
    pub added: Vec<String>,
    /// Names that were missing and could not be completed, with why, for the log.
    pub failed: Vec<(String, String)>,
}

pub fn complete(directory: &Path, staged: &Path, running: &Path) -> Completed
```

A filesystem function with no daemon in it, so it is tested on its own. `directory` is where the
binaries are, `staged` the running version's staging directory, and `running` the running
`mixengined`. It never returns an error: every failure is an entry in `failed`.

In order, stopping at the first "no":

1. **Missing names.** `COMPLETABLE` names whose file (with `EXE_SUFFIX`) is not in `directory`.
   None missing: return an empty `Completed`.
2. **The staged daemon.** `staged/mixengined[.exe]`, or `staged/<d>/mixengined[.exe]` where `<d>` is
   the only directory directly under `staged`. Anything else: every missing name goes to `failed`
   with "the payload is not laid out as a release".
3. **The same build.** SHA-256 of the staged daemon equals SHA-256 of `running`. Otherwise every
   missing name fails with "the staged payload is not this build".
4. **Per name.** The source is `<dir of staged daemon>/<name><EXE_SUFFIX>`. Missing from the payload
   means a failure with that reason. Otherwise copy it to `directory/<name>.new<EXE_SUFFIX>`, rename
   that to `directory/<name><EXE_SUFFIX>`, then `mixengine_platform::install::make_executable`. Any
   failure removes the `.new` file and records the reason.

**Never overwrites.** A name that exists is not missing and is not touched, including one an
installer placed.

### D3. Where the daemon calls it

In `main.rs`, as `Updates::complete_install`:

1. Right after `Updates::new`, which is where the placement is computed. That is later than the
   first `shims.refresh()`, so when anything was added `shims.refresh()` runs again. Only when the
   placement is `SelfUpdatable { directory }`.
2. `staged` is `Updates::staging_for(v)`, where `v` is the `to` of the `APPLIED` record when there
   is one (not yet consumed: `restore_after_update` runs later) and the running version otherwise.
   The directory is named after the feed's version; the hash in D2 is what ties it to this build.
   If it does not exist, stop.
3. Call `complete`. For each name in `added`, log `info` and append it to the store record
   `updates::records::COMPLETED`, a JSON list of names, deduplicated. For each entry in `failed`,
   log `warn`.
4. **Staging ownership.** Remove `staged` unless a copy failed on the install's side
   (`Completed::worth_retrying`). Another build, the wrong shape or a name the payload does not
   carry would fail the same way at every start, so the payload is not kept for those.

The order is: placement, then a `stat` per completable name, then the staging directory, then the
hash. A start with nothing missing does steps 1 and 2 of D2 and returns.

### D4. The uninstall row

- `ResidueId::CompletedBinary`: one row, *"program files this install added to itself: <names>"*,
  located at the install directory. One row rather than one per name, because the uninstall keys
  what it did by `ResidueId`.
- The inventory reads `updates::records::COMPLETED`. Only on a `SelfUpdatable` placement, and only
  when at least one recorded file exists, it makes the row: `Planned` in a plan, `Removed` after a
  real run read back off the disk, `Failed` naming what could not be removed. After removal the
  record is cleared, so a kept home reused by a fresh install does not remove that install's file.
- It is removed during `mix uninstall --yes`, before the daemon exits, and so before step 6 of the
  NSIS uninstaller. A locked file is reported the way the inventory already reports one. T182's P1
  holds: the uninstall can be run again.
- It is not kept by `--keep-home`: the file is part of the program, not of the home.
- `ResidueId::ALL` gains the variant and `bash packaging/bindings.sh` regenerates `bindings/`.
  MixLab renders `what` and `location` and has no case per id, so it needs no change.

### D5. Documentation

- `docs/features/updates.md`, in the Feed section beside the *"an update never adds one"* paragraph:
  the completion rule, its list and its conditions, linking ADR 0054.
- `docs/features/runtime-versions.md` (Shims): the fallback sentence gains *"until the first start
  completes the install (T185a)"*.
- `docs/decisions/README.md`: the row for 0054, and its status from Proposed to Accepted.
- `docs/roadmap/phase-7-efficiency.md`: T185a after T185, ticked when it lands.

## What does not change

- `swap`, its rules and its tests.
- The window is never added.
- `.pkg`, `.deb` and `.rpm` installs: their placement is not `SelfUpdatable`.
- T185's fallback in `shims::source`. It still covers every case completion does not.

## Tests

**Core, `updates::complete`:**
- a missing trampoline is copied and made executable; a second call adds nothing;
- a payload whose daemon differs from the running one adds nothing and reports why;
- a payload that holds `mixlab` does not add it (the window is not on the list);
- no staging directory, or an empty one, adds nothing;
- the `mixengine/` subdirectory layout and the flat layout are both found;
- a name missing from the payload is reported, and the others are still completed;
- a payload entry that is a directory rather than a file is reported and nothing is written;
- an existing file is not overwritten.
- `COMPLETABLE` does not contain the window's name.

**Daemon:**
- a home whose staging directory holds a payload built from the running daemon, with the
  trampoline absent beside it: after start, `bin\` holds trampolines, the record lists the name, and
  the staging directory is gone;
- the same, with the staging daemon's bytes changed: no completion, and the staging directory is
  kept;
- a placement that is not `SelfUpdatable`: nothing happens.

**Uninstall:**
- `--dry-run` lists a `CompletedBinary` row for a recorded file, and changes nothing;
- `--yes` removes it and reports `Removed`;
- a placement that is not `SelfUpdatable` has no row, whatever the record says.

A stale record is possible: an install completed here, then reinstalled by the full installer,
which placed the same file. The row still removes it. That is harmless, because the uninstaller
removes the program next; it is stated rather than guarded against.

**Real run on Windows, with a sandbox home:** stage a payload for the build under test, delete
`mixengine-trampoline.exe` beside the daemon, start it, and check `bin\` and the log.

## Out of scope

- Letting `swap` add names (ADR 0054, alternatives).
- Downloading the payload again when the cache is gone.
- Staging directories of *other* versions left by earlier updates. Removing those belongs to
  `mix cleanup`, which can gain it separately.

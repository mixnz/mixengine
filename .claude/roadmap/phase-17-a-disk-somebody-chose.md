# Phase 17 — A disk somebody chose

*Goal: the four directories that grow can be put on another disk — from the window, from the command
line, or from the flags a daemon is started with — and the choice is refused at the one moment it
stops being safe.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-15-t143-a-disk-somebody-chose-design.md](../../docs/superpowers/specs/2026-09-15-t143-a-disk-somebody-chose-design.md).

---

**The case this comes from**: a machine whose internal disk is small and whose working disk is an
external SSD, with `MIXENGINE_HOME` pointed at the external disk so that runtimes and databases
would land there. What that produced was an elevation prompt that took a password and then failed
with *the elevation helper left no report beside …* — because macOS gates a removable volume behind
TCC, and the helper, spawned through `osascript` and `authtrampoline`, arrives with no responsible
process to inherit a grant from. It could not read its own request, exited 65, and wrote no report.

Two things fall out of that, and they point in opposite directions.

**The home stays where each OS puts it.** `run/` is the elevated helper's whole contact surface —
the request, the response, `elevate.lock`, the helper candidate — and it has to be somewhere a root
process can read. `Paths::new` already refuses to move it, which is what makes everything below safe
without asking anybody for Full Disk Access.

**And what was actually wanted has existed since the beginning and is unreachable.** `[paths]` moves
`runtimes/`, `packages/`, `data/` and `logs/`, `run/` deliberately not among them. It is a commented
block in a TOML file inside a directory most people never open, and a window launched from Finder
cannot see `MIXENGINE_HOME` at all. This phase makes that choice reachable, and refuses it once the
first row has recorded an absolute path.

## The window, and the write

- [x] **T143** What may still be changed, and how it is written. `core::storage::changeable(store)`
      answers `Free` or `Taken { runtimes, packages, services }` from three counts — a row is what
      bakes a path in, so a row is what closes the window, and `logs/` is not consulted because
      nothing records where a log line went. `core::config::set_paths` edits a
      `toml_edit::DocumentMut` and replaces the file atomically, so the 60 lines of comments the
      template ships survive being written to; the values go through the same `config::relocation`
      validator `[paths]` already uses, so there is no second grammar to keep in step.

- [x] **T144** The flags on `mixengined`: `--runtimes`, `--packages`, `--data`, `--logs`, each
      optional and independent, each **writing into `config.toml`** rather than overriding one
      process — the location is in the rows, so a per-run override would let two daemons disagree
      about one home while the database agrees with neither. Three outcomes: a differing value with
      the window `Free` is written and logged; a value equal to what is stored is a silent no-op, so
      a launchd plist may carry the flag forever; a differing value with the window `Taken` **fails
      the start**, naming the counts and `config.toml`, on `--log-format`'s own precedent.

## Saying it and typing it

- [x] **T145** `mixengined --storage` prints the layout and the window as JSON and exits, creating
      nothing — not the home, not the config file, not the database. A flag rather than a subcommand
      because this binary has no subcommand tree, and it conflicts with `--detach` and the four
      relocation flags in clap: a read and a change are not one command line. `mix storage` forwards
      to it, the way `mix` already starts the daemon, because `mixengine-cli` depends on neither
      `mixengine-core` nor sqlx and so cannot count a row itself; `--json` hands back the daemon's
      own document unchanged. **No `mix init`** — the design's D5 records what it would have cost
      and what says its sentence instead.

- [x] **T146** MixLab draws it. A picker on the `notRunning` gate while the window is `Free`: one
      row per directory with a *Choose…* of its own, plus a shortcut that fills all four from one
      folder; **Start** passes only what changed to `health.rs::start_daemon` as T144's flags. While
      the window is `Taken` the same rows render read-only with the daemon's own sentence. Both
      dictionaries, and `storagePicker.ts` holds every decision as a pure function.

      **`notInstalled` is not one of the gates, and the design was wrong to name it.** The answer
      comes from `mixengined --storage`, so a machine that has no `mixengined` cannot be told where
      its directories would go. Such a machine sees the picker the first time it opens MixLab
      *after* installing — still before its first runtime, so the window is untouched.

## Written down

- [x] **T147** Measured and recorded. T144's three outcomes driven against a real daemon on a
      temporary home; the cross-crate check that nothing restated the layout twice — twelve entries
      from `paths.directories()` with four of them outside the root and `run/` not among those four,
      `RelocatedDirectory` rows in the uninstall inventory naming each moved directory, a shim that
      resolves unchanged because it reads neither key. Recorded in
      [overview.md](../architecture/overview.md)'s layout section,
      [client-surface.md](../features/client-surface.md) for the gate's new screen, and
      [ADR 0036](../decisions/0036-a-flag-may-configure-a-home-rather-than-a-process.md) for
      T144's rule: a flag that configures a home rather than a process.

      **Measured by hand on macOS**, on a home at `/private/tmp` with `runtimes/`, `packages/` and
      `data/` on an external `noowners` volume: PHP 7.0.33 installed to
      `/Volumes/SSD/…/runtimes/php/7.0.33` and ran from there; `install_path` recorded it;
      `uninstall --dry-run` named all three; a start carrying a differing `--data` afterwards exited
      1 saying *1 runtime and 1 service are installed*; and the queue was granted to
      **nothing is waiting for permission** — an elevated helper reaching a home whose data is on
      the chosen disk, with no Full Disk Access granted to anything.

      **The measurement found two bugs, and neither is this phase's.** None of PHP 7.0.33's
      extensions load on macOS, relocated or not — `module_file` writes a bare name and the comment
      above it claims Unix resolves that to `<name>.so`, which does not hold here; filed separately.
      And `helper-install` reported *cannot write `/Library/PrivilegedHelperTools/…`* when what had
      actually failed was reading its own binary off the external volume: `fs::copy` fails with one
      error for two files and the message named the wrong one. Eight prompts were granted against
      that sentence. Both halves are fixed here — the source is opened before the copy so the
      failure names the file that failed, and `Settled` carries each failure's sentence out to
      `GrantOutcome.problems`, which `mix elevation grant` prints under its line. A retryable
      failure is still a failure somebody has to be told about, and a count is not a diagnosis.

**Milestone M17** — on a fresh install the window offers a disk before anything is installed, a
runtime and a service land on it, `mix uninstall --dry-run` names it, and an elevation prompt still
succeeds.

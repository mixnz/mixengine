---
status: implemented
date: 2026-09-25
task: T185
---

# A `bin/` that weighs almost nothing

On Windows `<root>/bin` is one full copy of `mixengine-shim.exe` per command name. On the machine
this was measured on that is 38 copies of 5.87 MB, **about 223 MB**, for a directory whose job is to
hold names. This spec takes it to **under 20 MB** without giving up the reason the copies exist.

## Why the copies exist, and why that reason stays

[runtime-versions.md](../features/runtime-versions.md#shims) and `core::shims::link` state it: a
Windows shim **outlives the program it starts**. It stays as the parent of a Job Object child
instead of `exec`ing away as it does on Unix. If every name in `bin/` were a hard link to one file,
a `php -S` left running would hold that one file open, and the next upgrade, or the next
`cargo build`, would fail with a sharing violation. `place` can move a *copy* aside. It cannot move
aside the file every other name is.

So on Windows the file behind each name must be private to that name. This spec keeps that. What it
changes is **what is in that file**.

## What is in the file today

`mixengine-shim` links `mixengine-core`: sqlx with a bundled SQLite, tokio, and `Catalogue::builtin`.
That is how a version resolves in-process with no daemon ([T25](../roadmap/phase-2-runtimes.md)).
The resolution needs all of it. The part that has to outlive the child, holding the Job Object and
forwarding the exit code, needs none of it.

## Design

Split the Windows shim into two programs along that line.

```text
bin/php.exe  ── trampoline, one private copy per name, alive as long as the child ─────────┐
   │ 1. read bin/mixengine-shim.path: where the resolver is                                 │
   │ 2. run the resolver with MIXENGINE_SHIM_AS=php, stdout piped, stderr inherited          │
   │ 3. decode one handover record from that pipe; the resolver has exited                   │
   │ 4. hand_over(program, record args + its own args, env): Job Object child, exit code     │
   └────────────────────────────────────────────────────────────────────────────────────────┘
<install>/mixengine-shim.exe ── resolver, one file, alive only while it resolves
```

- **The trampoline** is a new crate and binary, `mixengine-trampoline`. It depends on nothing but
  `mixengine-platform` with `default-features = false, features = ["handover"]`. `handover` is a
  new feature and module holding `hand_over` (moved out from behind `process`, which pulls in
  tokio) and the record codec. This follows the `elevated` feature's precedent, so the rule "no OS
  calls outside `mixengine-platform`" holds, and `workspace_layering.rs` pins the dependency.
- **The resolver** is today's `mixengine-shim`, unchanged in what it resolves. When
  `MIXENGINE_SHIM_AS` is set it takes the command name from that variable instead of `argv[0]`,
  and wherever it would call `hand_over` it writes the record to stdout and exits 0. It is never
  in `bin/`, so nothing holds it longer than one resolution, and an upgrade replaces it like any
  other installed binary. A refusal is unchanged: its sentence on stderr, exit 127, nothing on
  stdout. The trampoline passes that code through.
- **The record** carries the program, the arguments that go *before* the user's (the
  `composer.phar` of T27c, otherwise none) and the environment to set. The user's own arguments
  never make the round trip: the trampoline appends the ones it was given. It is encoded
  losslessly per OS by `mixengine-platform` (UTF-16 on Windows, bytes on Unix), so a path or a
  `PATH` that is not valid Unicode survives.
- **The trampoline finds the resolver through `bin/mixengine-shim.path`**, one line written by
  `shims::refresh` holding the resolver's absolute path, which is where `shims::source` found it.
  `sweep` keeps that name. A missing or dangling file is exit 127 with a sentence naming the file
  and the fix (restart the daemon).
- **A Windows install with no trampoline falls back to the shim**, copied per name as before this
  task. That is every install that updates itself onto this release: `updates::apply::swap` never
  adds a binary the install lacked. It works and stays heavy until the next full install; letting
  an update add a binary is a rule change for its own ADR. (Found in the final review.)
- **Unix does not change.** There the shim `exec`s away and `bin/` is already hard links to one
  file. `shims::refresh` places the trampoline on Windows and the shim elsewhere, reading the same
  `cfg!(windows)` constant `link` reads today.
- **The trampoline is built small** through `[profile.release.package.mixengine-trampoline]`:
  `opt-level = "z"`, `strip = "symbols"`, `codegen-units = 1`. Per-package overrides cannot set
  `lto` or `panic`, and the workspace `release` keeps `panic = "unwind"` for the daemon's reason
  stated in `Cargo.toml`. A separate profile would add a second compile of the tree to every
  packaging run (see *Follow-up*).

## Measured

Spike on Windows 11, this machine, 2026-09-25. Built outside the repository. `php -v`, 100 runs per
variant after 5 warm-up runs, interleaved across 3 rounds.

| | per name in `bin/` | `bin/` total (38 names) |
|---|---|---|
| today | 5.87 MB | ~223 MB |
| shim built with `opt-level=z`, fat LTO, `panic=abort`, stripped | 2.68 MB | ~102 MB |
| trampoline with that same profile + one resolver | 190 KB + one 2.68 MB | ~10 MB |
| **this design** (trampoline per-package override, resolver as released) | ~300 KB (estimate) + one 5.87 MB | **~17 MB** |

| `php -v` via | min | median |
|---|---|---|
| `php.exe` directly | 50–51 ms | 56–63 ms |
| today's shim | 127–132 ms | 140–162 ms |
| shim with the size profile | 125–132 ms | 138–159 ms |
| trampoline → size-profile shim (the process shape of this design) | 111–145 ms | 129–162 ms |
| trampoline → `php.exe` | 62–70 ms | 72–94 ms |

- **The extra process costs 10–15 ms** in isolation (trampoline → `php.exe` against direct).
  Against the full shim it is below the run-to-run noise: +13, +6 and −14 ms on the minimum across
  the three rounds.
- **The size profile does not slow the shim.**
- **Today's shim already spends 50–80 ms more than `php.exe` alone**, far over T29's 15 ms budget.
  That is not caused by this design, and this design does not fix it. It is a separate task (below).

  > **Corrected 2026-09-25, after this spec was implemented.** The comparison above was not like for
  > like: `php.exe` alone loaded no `conf.d`, and the shim hands it `PHP_INI_SCAN_DIR`. Measured
  > layer by layer (release shim, PHP 7.3.33, minimum of 60–100 runs), `php -v` through the shim is
  > ~97 ms against ~26 ms direct, and of the ~71 ms: **~40 ms is PHP loading the 27 extensions
  > `conf.d` enables** (the same `php.exe` given only that variable takes 65–68 ms; `PATH` alone
  > changes nothing); ~10 ms is the second process Windows cannot avoid; ~7 ms is loading the 5.6 MB
  > shim image; **~5 ms is the resolution T29 budgets**, well inside 15 ms; ~9 ms is the hand-over.
  > The shim's own share is about 30 ms, not 50–80.

## What does not change

- The commands in `bin/`, per [ADR 0033](../decisions/0033-bin-is-a-projection-of-what-is-installed.md).
- `is_current` and the move-aside path in `place`. On Windows they compare the trampoline now.
- What a resolved program inherits: `PATH`, `PHP_INI_SCAN_DIR`, `JAVA_HOME`, `GOTOOLCHAIN`, and the
  rest in [runtime-versions.md](../features/runtime-versions.md). The record carries exactly what
  `hand_over` receives today.
- Exit 127 and the one-sentence error on stderr.
- `MIXENGINE_SHIM_AS` never reaches the program: it is set on the resolver's command only.

## Tests

- The existing shim suites run against the trampoline on Windows. They drive `bin/<name>`, so they
  need no rewrite.
- The record round-trips, including a value that is not valid Unicode.
- A resolver asked through `MIXENGINE_SHIM_AS` writes a record, starts nothing, and exits 0.
- A trampoline whose resolver refuses exits 127 and leaves stderr as the resolver wrote it.
- A trampoline with no `mixengine-shim.path` exits 127 and names the file.
- The property this design rests on: while a program started through `bin/php.exe` is still
  running, the resolver can be replaced.
- T29's overhead suite reports the trampoline chain's wall clock on Windows.

## Follow-up, not in this task

- **Where the 50–80 ms goes.** Startup of the full shim alone, exiting at dispatch, is about 24 ms.
  The remainder is in resolution and hand-over. It needs profiling, and belongs with T29.

  > **Answered 2026-09-25** — see the correction under *Measured*: most of it is PHP's extensions,
  > not the shim. What is left to shorten, largest first: the default PHP extension set (~40 ms, a
  > product decision, since `php -m` on a terminal has to match the pool), the hand-over (~9 ms),
  > and the shim's pre-`main` start (~7 ms; the size profile did not change it).
- **A size profile for the resolver** (5.87 → 2.68 MB, once). It needs a second `cargo build
  --profile` in `packaging/stage.sh` and in CI's `binaries` job. After this task it saves 3 MB once,
  not per name.
- A trampoline written against `windows-sys` without `std`'s process layer could weigh tens of KB.

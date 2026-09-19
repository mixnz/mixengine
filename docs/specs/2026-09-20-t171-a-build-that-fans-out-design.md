---
status: implemented
date: 2026-09-20
task: T171
---

# T171 — A build that fans out

Follows [T170](2026-09-19-t170-a-test-job-that-scales-design.md), whose milestone M24 asks for every
`build` leg of a warm branch run to finish in 20 minutes. T170 took the waste out of `test`; this
spec does the same for `build`, which is now the job every run waits on.

## Problem

Run 35458805745 (`master` at `e81d20e4`, requested 2026-09-19, the first run after T170 merged):

| Leg | Build the window | Artifacts (binaries + packaging) | Leg |
| --- | --- | --- | --- |
| windows-latest | 604 s | 371 s | 19 min |
| windows-11-arm | 776 s | 532 s + 89 s smoke build | 25 min |
| ubuntu-22.04 | 624 s | 652 s | 22 min |
| ubuntu-22.04-arm | 467 s | 488 s | 17 min |
| macos-latest | 986 s | not measured separately | 29 min |

T170 C1 already builds branches without LTO. What is left has two causes, and neither is waste
inside a step.

### Cause 1: each leg runs two independent release builds one after the other

`packaging/desktop.sh` builds the window (its own Cargo workspace, ADR 0027), then the per-OS
`build.sh` calls `packaging/stage.sh`, which builds the four headless binaries from the root
workspace. **Neither build reads anything the other one writes.** Only the packaging at the end
needs both. Yet one runner does them in series, so the leg costs their sum.

T170 C2 tried to run the two at once on the same runner. It was slower (31.1 min on macOS against
22.7) because two release builds on one machine split the same CPUs. That result still holds. What
it rules out is sharing a runner, not running in parallel.

### Cause 2: macOS builds everything twice

The `.pkg` is universal. `desktop.sh` builds the window with `--target universal-apple-darwin`,
which is an x86_64 build and an aarch64 build followed by `lipo`. `packaging/macos/build.sh` calls
`stage.sh` once per slice. So the macOS leg runs four release builds in series, and it is the
slowest leg.

A caching fix is not available. The repository's cache holds 10.6 GB against a 10 GB quota even
though only `master` saves since T170a, and the window's release target alone is about 1.4 GB per
system. Buying cache was declined when T170 was scoped.

## Goals

- A branch run's `build` path (from the first of its jobs starting to the last finishing) takes 18
  minutes or less on every system, cold. Today it takes 17–29.
- A tag builds exactly what it builds today: universal on macOS, full release profile everywhere.
- Nothing that a branch run checks today goes unchecked on every run. What a branch stops checking,
  `master` checks.

## Non-goals

- A lower `opt-level` for branch builds. It is a one-line change and could come later, but it was
  not chosen here.
- Caching release builds.
- Changing what the artifacts contain on a tag, or how `release` signs and publishes them.
- `bench`. It is measured again after this lands and gets its own task if it needs one.

## Design

### E1. Every `build` leg becomes three jobs: `window` ∥ `binaries` → `build`

| Job | Runs on | Does | Uploads |
| --- | --- | --- | --- |
| `window (os)` | the leg's runner | `packaging/desktop.sh` | `window-<os>`: a tar of `target/packaging/window/<key>` |
| `binaries (os)` | the leg's runner (Linux: in the manylinux container, as today) | `packaging/stage.sh --build-only` per target; the Windows ARM smoke build | `binaries-<os>`: a tar of the headless binaries under `target/<triple>/release/` |
| `build (os)` | the leg's runner | downloads both, unpacks them where the builds left them, runs the per-OS packaging and the probes | `mixengine-<os>`, unchanged |

- **`window` and `binaries` have no `needs`**, so they start with the rest of the run. `build` has
  `needs: [window, binaries]` and runs only its own leg's packaging. The matrix stays in one place:
  each of the three jobs uses the same `include` list, and `build` downloads by `matrix.os`.
- **`needs` waits for the whole matrix, not for the leg.** Actions has no per-leg dependency
  between two matrix jobs, so every `build (os)` starts only when the slowest of all ten `window`
  and `binaries` legs has finished. That was found while measuring Task 2, after the design was
  agreed, and it is accepted. A run ends with its slowest leg either way, so the loss is at most
  the difference between the packaging times, a few minutes. A per-leg dependency would mean five
  hand-written `build` jobs without a matrix, five copies of every step to keep in step, and that
  costs more than those minutes.
- **Tars, not the raw files.** `upload-artifact` drops file modes and symlinks. An executable that
  arrives non-executable is a failure that looks nothing like its cause, and a macOS application
  bundle does not survive the trip without its symlinks.
- **`build` keeps its name.** `release` keeps `needs: build`, the `jobs` input keeps its `build`
  option (which now gates all three jobs), and a reader of the run sees the job that produced the
  artifacts under the name it always had.
- **`release` downloads `mixengine-*` only** (`pattern:`). Today it downloads every artifact of the
  run into `legs/`, and moving `desktop-<os>` in along with the rest was harmless only by luck. Two
  intermediate artifacts per leg make it harmful.
- `binaries-<os>` is kept for one day. `window-<os>` replaces `desktop-<os>` and keeps its 14 days,
  because a window someone wants to try without the installer is a reason to download one.

**Script changes.** In `stage.sh`, one flag and one variable:

- `--build-only` compiles, exactly as today, and stops before staging.
- `MIX_PREBUILT=1` skips the compile and goes straight to staging. The existing check "a stage
  missing a binary is the failure this whole job exists to notice" still runs, so a download that
  lost a file fails there by name.

The window needs no flag. `stage.sh` already builds it only when nothing staged it (T105, D2), and
the unpacked `window-<os>` is exactly that staged copy. The `MIXENGINE_RELEASE` check in each
`build.sh` keeps working unchanged: it runs the staged binary, which is the one `binaries` built.

### E2. On a branch, macOS builds the aarch64 slice alone

Which slices to build becomes a property of the ref, set once in the step C1 added ("Choose the
release profile") and read by the scripts as `MIX_MACOS_SLICES`:

| Ref | Profile (C1) | macOS slices |
| --- | --- | --- |
| a `v*` tag | `[profile.release]` unchanged | `x86_64 aarch64` (universal) |
| `master` | light | `x86_64 aarch64` (universal) |
| any other branch | light | `aarch64` |

- `desktop.sh` builds `--target universal-apple-darwin` for two slices and
  `--target aarch64-apple-darwin` for one. `mix_window_key` follows the slices, not the OS alone.
- `macos/build.sh` stages each slice it was given. It runs `lipo -create` for two slices and copies
  the file for one. Its architecture checks assert exactly the slices it was given: for two, that
  both are there, as today; for one, that `arm64` is there and `x86_64` is not, so a branch artifact
  never passes for universal.
- The file names say what is inside: `macos-universal` for two slices, `macos-arm64` for one.
  `macos/probe.sh` reads the name instead of assuming it.
- **`master` stays universal**, so the `lipo` path and the x86_64 release build run on every merge,
  before any tag.

### E3. On a branch, macOS still compiles for x86_64

A branch that stops building x86_64 would stop noticing code that does not compile there. That
would be rare, since the platform code branches on the OS far more than on the architecture, but
the first place anyone would find out is a tag. So a branch that builds one slice also runs
`cargo check --locked --target x86_64-apple-darwin`:

- in `binaries (macos)`, over the same `-p` list `stage.sh` builds;
- in `window (macos)`, in `apps/desktop/src-tauri`, after the frontend is built, because
  `tauri::generate_context!` reads it at compile time.

`check` generates no code, so each costs minutes, not a second release build. Between them, a
branch still compiles every shipped crate for both slices. It no longer links the x86_64 slices or
runs `lipo`, and `master` covers both (E2).

### E4. Budgets

Every one of the three jobs keeps T170 B3's clock and budget step. `window` and `binaries` target 15
minutes, `build` targets 5. The number that matters is the path, so `build` also writes, in its step
summary, the time from the earlier of its two dependencies starting to its own end. The start comes
from the jobs API through `gh run view --json jobs`, so neither dependency has to pass a timestamp
along.

## Expected result

Cold branch run, estimated from run 35458805745's step times plus about 1.5 min of setup per job and
3–4 min of packaging:

| Leg | Today | Path after E1–E3 |
| --- | --- | --- |
| windows-latest | 19 min | ~15 min (window) |
| windows-11-arm | 25 min | ~18 min (window) |
| ubuntu-22.04 | 22 min | ~15 min (binaries, in the container) |
| ubuntu-22.04-arm | 17 min | ~13 min |
| macos-latest | 29 min | ~16 min (aarch64 window + x86_64 check) |

`master` keeps universal macOS: its path is about 20 minutes (the universal window, 986 s, plus
packaging). The M24 target of 20 minutes for `build` holds on `master` too. It is not below 15 on
every leg, and this spec does not promise that. Windows ARM is limited by one release build of the
window on that runner.

### Measured (2026-09-19, cold, branch `ci/t171-build-fans-out`)

| Run | What | Before T171 | After |
| --- | --- | --- | --- |
| 35461808066 | `--jobs build`, E1 only (macOS still universal) | 29.5 min (`master` 35458805745) | 21.6 min |
| 35464754026 | every job, E1–E3 | about 30 min (`master` 35458805745) | 23.9 min |

In the full run, `window` and `binaries` took these times per leg, with `build` after them:

| Leg | `window` | `binaries` | `build` |
| --- | --- | --- | --- |
| windows-latest | 18.3 min | 11.5 | 2.2 |
| windows-11-arm | 15.0 | 7.4 | 3.7 |
| macos-latest | 15.3 (aarch64 + 97 s x86_64 check) | 7.0 (+ 77 s check) | 0.6 |
| ubuntu-22.04 | 11.9 | 4.5 | 2.1 |
| ubuntu-22.04-arm | 9.0 | 5.3 | 1.6 |

The artifacts came out as the same 80 file names as `master`'s. The Gatekeeper probe read the same
things it always reads, and no `build` job compiled anything.

**The 18-minute goal is not met**, for three reasons:

- `window (windows-latest)` took 17–18 min in all three T171 runs. Its build step is untouched by
  this spec and took 604 s in run 35458805745, so it varies between 600 and 1030 s. It is now the
  slowest job in the run and the next thing to look at.
- `needs` waits for the whole matrix (E1). The Linux legs were ready 8 minutes before `build`
  started.
- The queue, described under Concurrency.

## Rollout

1. E1 on all five legs, with the macOS slices unchanged (universal everywhere). Measure a branch
   run and compare each leg's artifacts with `master`'s: same file names and the same entries
   inside.
2. E2 and E3 together. Neither is safe without the other. Measure a branch run, then request a run
   on `master` and confirm it still produces `macos-universal`.
3. M24 is measured on a branch after `master` has run once.

## Concurrency

The free plan runs 20 jobs and 5 macOS jobs at once. The fan-out adds two jobs per leg, ten in all,
two of them on macOS. The `build` jobs cannot start before their dependencies, so they rarely
compete with them. But a full run already has 5 macOS jobs (`test`, `services`, `system`, `bench`,
`build`), and `window` and `binaries` make 6 that want to start together. One of them queues until
another finishes, which is most likely `test (macos)` at 7 min. That delay is part of what the
measurement in Rollout step 2 is for.

The 20-job limit matters more. A full run asks for 29 jobs before any `build` can start, so 9 wait,
and whichever of them waits is not ours to choose.

**Reordering the jobs in `ci.yml` was tried and withdrawn.** The idea was to write the longest
paths first, on the guess that the queue fills in file order. Run 35464754026 disproved that guess.
`system`, `rustdoc` and `docs`, which were written last, started at once. `window (windows-11-arm)`
and `window (macos-latest)`, written first, waited about 4.5 minutes. With no effect to show for
it, the reorder only moved about 2000 lines, so it was reverted before merge.

## Documentation

- `docs/operations/build-and-release.md`: the three jobs, what each artifact is, and the slice table
  in E2.
- `packaging/stage.sh`, `packaging/desktop.sh` and `packaging/macos/build.sh`: their header comments
  gain `--build-only`, `MIX_PREBUILT` and `MIX_MACOS_SLICES`.
- Roadmap: T171a–T171c in phase 24, under M24.

## Risks

- **A packaging script that quietly compiles again.** If `MIX_PREBUILT` failed to reach
  `stage.sh`, `build` would just rebuild everything and still come out green, only slow. The tars
  carry only the finished binaries, so cargo's own bookkeeping (`target/<triple>/release/deps`,
  `.fingerprint`, and the window's `src-tauri/target`) exists in `build` only if something compiled
  there. `build`'s last step fails when it finds any of them. The runner images come with Rust, so
  leaving the toolchain out would not stop a compile. `macos/build.sh`'s `rustup target add` moves
  to where the slices are built.
- **An artifact from a different commit.** An artifact belongs to the run that made it. `build`
  downloads from its own run, which is the default for `download-artifact`, and never by run id.
- **Branch macOS artifacts do not run on Intel Macs.** They are not releases (C1 already says so),
  and the file name now says `arm64`.

## Decisions

1. **Three jobs, not two.** Putting the packaging at the end of `binaries`, with `needs: window`,
   would make `binaries` start only after the window finished: the serial path again under another
   name.
2. **`master` stays universal** (E2). This is the user's choice: every merge proves `lipo` and the
   x86_64 build before a tag does.
3. **x86_64 is checked on branches, not built** (E3). This is also the user's choice. A check costs
   minutes; a build is what E2 removes.

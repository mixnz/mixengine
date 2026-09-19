---
status: approved
date: 2026-09-20
task: T172
---

# T172 — A workflow a person can read

T170 and T171 made CI faster, and made `.github/workflows/ci.yml` longer. This spec changes how the
CI definition is laid out. It does not change what CI checks.

## Problem

`ci.yml` is 3094 lines at `2060a0ca`. That is one file, fourteen jobs, and no way to read one job
without scrolling past the others. Here is what the lines are:

| What | Lines | Where |
| --- | --- | --- |
| Comments | 1069 (35%) | everywhere; much of it history ("measured on run …", "the first run of this job …") |
| Bash inside `run:` | ~900 | `services` 366, `system` 162, `build`+`binaries` 126, `release` 54 |
| Near-copies | ~600 | 11 "Fetch a real X" steps of about 40 lines each; the clock and budget pair ×7; "Choose the release profile" ×3 |
| One job | 820 | `services` alone is a quarter of the file |

The cost is real and recent:

- **A bash bug inside YAML.** T171's `case … )` inside `$( … )` failed on macOS's bash 3.2
  (run 35463527479). Bash in a `run:` block cannot be linted or run locally. A `.sh` file can.
- **The same fix is made eleven times.** The fetch steps differ in a version, a variable, a probe
  command and at most one "not published for this runner" row. `.github/scripts/fetch-package.sh`
  already does the common part for `bench`. Its own header says it was kept out of `test` on
  purpose, to avoid refactoring seven working steps during M3. This spec is that refactor.
- **Reviewing a CI change means reading 3000 lines.** T171's diff had to be checked against a file
  in which the job it changed was 400 lines out of 3094.

## Goals

- `ci.yml` is about 250 lines or less: triggers, inputs, concurrency, the shared environment, and
  one entry per job family.
- No workflow file passes 500 lines.
- No `run:` block passes 15 lines. Anything longer is a script under `.github/scripts/` that can be
  run and linted locally.
- **CI checks exactly what it checks today.** The same suites run on the same runners with the same
  environment. The same artifacts come out under the same names, and every budget line is still
  written.

## Non-goals

- Making CI faster. T171's follow-up (the 17-minute Windows window build) is a separate task.
- Adding `shellcheck` to `lint`. The scripts become lintable, but turning a linter on across
  `packaging/` and `.github/scripts/` is its own piece of work with its own findings.
- Changing which jobs exist, their matrices, or their `jobs` input groups.
- Changing the comment policy anywhere other than `.github/workflows/`.

## Design

Five steps, in this order. Each one leaves CI working and is checked by a run before the next
begins. The first four stay inside one file, so each diff reads against a file that has only moved
its own parts. The split into several files comes last.

### F1. Every fetch goes through `fetch-package.sh`

The script gains two optional arguments and keeps its current signature for `bench`:

- `--absent-on <RUNNER_OS-RUNNER_ARCH>` (repeatable). On that runner it prints a `::notice::` naming
  the program and exits 0 without setting the variable. This is exactly what the nginx and Redis
  steps do today on Windows ARM, where each suite already skips when its variable is unset.
- `--probe "<path> <args>"` (repeatable). After unpacking, it runs the first probe whose program
  exists, relative to the unpack directory and with `.exe` appended on Windows. A broken archive
  then fails in the fetch step rather than in a suite. PHP names two, `bin/php` and `php`, because
  the publisher's layout differs between Unix and Windows.

Each of the eleven steps becomes a `name`, an `if` and one script line, and loses about 35 lines.
Where a step does something only it needs, a short comment stays. nginx packs a whole tree because
the generated configuration reads its `conf/` by absolute path. PHP has a layout of its own.

### F2. Two composite actions for the step pairs every build leg repeats

In `.github/actions/`:

- `leg-budget`: the "Start the clock" and "Budget" steps (T170g). It takes `phase: start|end`,
  `target-minutes` and `ceiling-minutes`, and writes the same summary line and the same
  notice/warning as today.
- `release-profile`: "Choose the release profile" (T170h, T171c), today written three times.

The toolchain install (three lines) and the `rust-cache` blocks (their keys differ per job) stay
inline. A composite action for three lines only moves them.

### F3. Long `run:` blocks become scripts

Every `run:` longer than 15 lines moves to `.github/scripts/<job>-<what>.sh`. The script reads the
same environment variables, and the step calls it with `bash`. `test-no-network.sh` and
`test-absent-secret-service.sh` are the existing examples.

Counted at `2060a0ca`, only 15 blocks pass 15 lines of code. Eleven of them are the fetch steps F1
already removes, so F3 moves four:

- `system`'s "What the uninstall suite left behind" (17 lines);
- `binaries`' "Hand the binaries on" (16);
- `preflight`'s "The tag, the version, the key and the secrets agree" (20);
- `release`'s "Verify what was published, and not only what was signed" (19).

Most of the bash counted under Problem is the fetch steps, plus the comments inside `run:` blocks
that F4 handles.

### F4. Comments say why; history moves to the documentation

A comment in a workflow keeps what a reader needs at that step: why the step exists, the constraint
it guards, and which task or ADR owns it. Two or three lines, and a link when there is more to say.
The following move into `docs/operations/build-and-release.md`, under a new "Why CI is shaped this
way" section, one entry per job family, **moved rather than deleted**:

- measurement narratives ("measured on run …", "the first run of this job got through …");
- superseded reasoning ("the timeout moved from 60 to 75 …");
- the longer arguments.

A comment that would still be true with the step deleted belongs there, not beside the step.

### F5. One file per job family, called from `ci.yml`

| File | Jobs |
| --- | --- |
| `ci.yml` | triggers, `inputs.jobs`, concurrency, `permissions`, and one `uses:` per family |
| `_lint.yml` | `lint`, `bindings`, `docs`, `desktop` (the ubuntu-only checks) |
| `_test.yml` | `test`, `rustdoc` |
| `_services.yml` | `services` |
| `_system.yml` | `system` |
| `_bench.yml` | `bench` |
| `_build.yml` | `window`, `binaries`, `build` |
| `_release.yml` | `preflight`, `release` |

Each called workflow is `on: workflow_call` with one input, `jobs`, and keeps its jobs' `if:` as it
is. `ci.yml` passes `inputs.jobs` through. The leading underscore sorts them together and marks them
as not triggerable on their own.

What moving into called workflows changes, all known in advance:

- **Job names gain a prefix.** They read `services / services (windows-latest, web)` in the UI and
  the jobs API. `master` has no branch protection and no required checks (checked 2026-09-20), so
  no check name has to be kept. `scripts/watch-ci.sh` reads `.name` only to print it. `build`'s
  "The whole path" step selects jobs by name and changes to match the suffix.
- **The top-level `env:` does not reach a called workflow.** Its four variables
  (`CARGO_TERM_COLOR`, `CARGO_INCREMENTAL`, `CARGO_PROFILE_DEV_DEBUG`, `RUST_BACKTRACE`) are declared
  again at the top of each called workflow. A comment in `ci.yml` says that is where they live.
- **`release` needs `build` across files.** In `ci.yml` the entry for `_release.yml` has
  `needs: [lint, test, build]`, naming the calling jobs, with `secrets: inherit` for the signing
  keys.
- **Concurrency stays in `ci.yml`.** A called workflow runs inside its caller's group.

## Expected result

| File | Lines, estimated |
| --- | --- |
| `ci.yml` | ~200 |
| `_services.yml` | ~350 (the largest) |
| every other called workflow | 60–300 |
| total across `.github/workflows/` and `.github/actions/` | ~1600, against 3094 |

## Verification

After each of F1–F5, one full run (`scripts/ask-ci.sh`), compared with the last `master` run on:

- **every job green**, the same set of jobs by suffix name;
- **the same test counts**: each `nextest` summary line (`N tests run: … passed`) and each suite's
  `test result:` line has the same numbers;
- **the same artifacts**: `mixengine-*` holds the same 80 file names;
- **the same budget lines** in every step summary.

Not compared: timings, which vary by runner (T171 measured the same untouched step at 600 s and
1030 s).

## Rollout

One commit per step (T172a–T172e). The branch is merged after F5's run is green. A tag is not cut
between steps, because `_release.yml` is only exercised by a tag. The first tag after this merge is
also the first run of the release path in its new file. That is written into the release
checklist as "read the `release` job's log in full".

## Risks

- **A moved comment that should have stayed.** F4 is a judgement per comment. The rule above is the
  test, and the reviewer reads F4's diff as a diff of comments alone, because no code moves in it.
- **A script that behaves differently outside YAML.** A `run:` block gets `bash -e -o pipefail`
  from Actions. A script opens with `set -euo pipefail` itself, and `-u` is stricter than what the
  block ran under. Every script is run once locally where it can be, and F3's CI run is the check
  for the rest.
- **`release` is untested until a tag.** See Rollout.

## Decisions

1. **Scripts and composite actions before the split** (the user, 2026-09-20). Each step is checked
   on its own, and the split in F5 moves blocks that are already short.
2. **History comments move, and are not deleted** (the user, 2026-09-20).
3. **Called workflows, not one workflow per job family with its own triggers.** Separate workflows
   would each need the `inputs.jobs` choice, their own concurrency group and their own dispatch.
   `ask-ci.sh` would then have to start several runs and `watch-ci.sh` wait for several. With
   called workflows it stays one run.

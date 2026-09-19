---
status: approved
date: 2026-09-19
task: T170
---

# T170 — A test job that scales

The roadmap entry is [phase 24](../roadmap/phase-24-a-test-job-that-scales.md), tasks T170a–T170l.

## Problem

Run 35430523430 (`feat/t167-sites-stay-up`, dispatched 2026-09-19) was cancelled by the `test`
job's own `timeout-minutes: 45` on the Windows leg, at 45 min 30 s. **Nothing failed and nothing
hung.** Every test step on that leg was green. The job was killed during post-job cleanup, after
`Swatinem/rust-cache` had spent 156 s saving 853 MB. The comment on that limit already says what
45 means: "the line past which waiting stops being the answer, not a budget". This spec keeps it
that way. It does not raise the ceiling. It removes the waste that brought the leg up to it, and it
reshapes the job so that the next package adds a parallel leg rather than serial minutes.

### Where the 45 minutes went (Windows leg)

| Step | Time | What it was |
| --- | --- | --- |
| Setup, toolchain, `cargo fetch`, package fetches | ~2 min | fine |
| `Build tests` | 8.0 min | 303 crates, **cold**: `rust-cache` logged `No cache found` |
| `Test` (`cargo test --workspace`) | 9.5 min | 145 test binaries, run one after another |
| 17 real-program suites (Caddy … MongoDB) | 22.5 min | see causes 2 and 3 |
| Doc tests | 0.2 min | fine |
| `rustdoc` | 2.4 min | recompiles 48 crates in check mode |
| `Post Run rust-cache` | 2.6 min | saving the cache is what crossed 45 |

The macOS leg took 20 min and the Ubuntu leg 18 min in the same run. Windows is the critical path.

### Cause 1: the repository's cache is full, so every run builds cold

GitHub keeps at most 10 GB of Actions cache per repository and evicts the least recently used entry
beyond that. On 2026-09-19 the repository held **10.50 GB in 21 entries**, and one run of
`feat/t167-sites-stay-up` accounted for most of it:

| Job | Size per leg | Legs |
| --- | --- | --- |
| `build` (release, two workspaces) | 1.07–1.40 GB | 3 cached (the two container legs cache nothing) |
| `desktop` | 1.51 GB | 1 |
| `test` | 0.66–0.81 GB | 3 |
| `system` | ~0.63 GB | 3 |
| `bench` (release) | 0.47–0.49 GB | 3 |
| `lint`, `docs`, `bindings`, `pages`, npm | 0.05–0.33 GB each | 9 |

One full run writes roughly one full quota. Every branch run evicts `master`'s entries. No `test`
entry for `master` was left, and a branch can only restore its own entries or `master`'s. So the
first run of every branch is cold, and in practice every run is cold. The Windows and macOS legs of
35430523430 both logged `No cache found`. A warm build was measured at 313 s against 602 s cold (the
comment on the job's timeout). The per-suite recompiles in cause 2 and the rustdoc recompile would
also be mostly cache hits on a warm run.

### Cause 2: the per-suite steps rebuild dependencies

`Build tests` compiles `--workspace --all-targets --all-features`. Every real-program step then runs
`cargo test -p <package> --test <suite>` with no `--all-features` and with a different package
selection. Cargo's resolver unifies features over the packages selected, so a different selection
is a different feature set, and cargo rebuilds everything whose features changed:

| Step | Crates compiled | Build time | Test time |
| --- | --- | --- | --- |
| `connections` (`-p mixengine-platform`) | 43 | 55 s | 0.00 s |
| `caddy` (first `-p mixengine-cli` step) | 48 | 52 s | 69 s |
| `php_modules` (`-p mixengine-core`) | 41 | 57 s | 0.89 s |
| each later `-p mixengine-cli` step | 1 | ~3 s | — |

That is about 3.5 minutes spent compiling what was already compiled.

### Cause 3: fixtures deflate hundreds of megabytes with unoptimised code, on Windows

The MariaDB, MySQL, PostgreSQL and `instances` suites pack the unpacked CI download back into an
archive for a mock registry to serve (`FakePackage::build` in
`crates/mixengine-testkit/src/package.rs`). On Windows the archive is a zip, deflated by
`miniz_oxide`. Nothing in the workspace sets a `[profile.dev.package]` override, so the compressor
runs at opt-level 0. Each test packs its own copy, so two tests in one suite pack the same directory
twice, in parallel. The time from `running N tests` to the suite's first `installing the package`
line:

| Suite | Windows (zip, deflate) | macOS (tar.zst) |
| --- | --- | --- |
| mysql | 88 s | 14 s |
| instances | 64 s | — |
| mariadb | 38 s | 7 s |
| postgres | 28 s | 3 s |

The install that follows spends another 11–20 s in the daemon, which is also a debug build. It
inflates the archive and hashes it with `sha2`. The daemon decompresses `.tar.zst` with `ruzstd`,
which is also unoptimised. In total that is about 4–5 minutes of the Windows leg spent in
compression code running at opt-level 0.

### Cause 4: everything is one serial job

Unit tests, integration tests, 17 real-program suites, doc tests and rustdoc all run one after
another on one runner per OS. Each new package brings a suite with its own step. Phase 19 (MongoDB)
added one, and every recipe in the gallery is a candidate for another. Each one adds its minutes to
the same 45-minute line. Within the workspace step, `cargo test` also runs the 145 binaries one at a
time, and a single slow binary (`idle.rs`, 61 s) holds up the rest.

## Goals

- **Waiting for a branch run takes 15 minutes or less.** On a warm cache, every leg of every job
  finishes within 15 minutes. The one exception is `build`, whose legs finish within **20 minutes**:
  it has no cache (A1), and its target is what part C reaches without one. No leg of any job takes
  more than 30 minutes, which is two thirds of the ceiling, even when its cache is cold. Tag runs
  build with the real release profile (C1), and only the 30-minute line applies to them.
- A branch run restores `master`'s cache instead of starting cold.
- A new real-program suite adds its own time to a leg that runs in parallel, not to the critical
  path. When a leg grows too long, splitting it is one new matrix entry.
- Every suite that runs today still runs, on the same operating systems, with the same `#[ignore]`
  discipline. A leg where a suite did not run still says so.
- A developer's plain `cargo test --workspace` keeps working and keeps passing. CI may run faster
  than that, but not differently from it.

## Non-goals

- Raising `timeout-minutes` on any job.
- Making any individual test faster by changing what it asserts.
- Changing what `build` produces on a tag, or what `bench` measures and against which profile.
- Larger runners, self-hosted runners, or paid cache storage. Paid storage was considered on
  2026-09-19 and declined. It would have let `build` and `bench` cache, and brought `build` under
  15 minutes too.
- Skipping `build` or `bench` on a branch because of which paths its diff touches: `all` stays all.

## Design, part A: remove the waste

Each item stands alone and lands as its own commit, so each one's effect is measured on its own.

### A1. `master` writes the cache and branches only read it

- Every `Swatinem/rust-cache` step gets `save-if: ${{ github.ref == 'refs/heads/master' }}`. A
  branch or tag run restores `master`'s entry for its key and saves nothing. `rust-cache`'s
  restore keys fall back to the newest entry with the same prefix, so a branch whose `Cargo.lock`
  differs still starts from `master`'s build.
- The `test` job keeps `cache-on-failure: true`. On `master` it still matters: a cut-off `master`
  run should save what it compiled.
- **The `build` job stops caching altogether, on `master` too.** Without it, one `master` run
  writes about 8.5 GB:

  | Entries | GB |
  | --- | --- |
  | `test` ×3 | 2.25 |
  | `system` ×3 | ~1.9 |
  | `desktop` | 1.5 |
  | `bench` ×3 | 1.45 |
  | `rustdoc` ×1, Windows only (A4) | ~0.2 |
  | `lint`, `docs`, `bindings`, `pages` ×2, npm ×4 | ~1.2 |

  `build`'s three cached legs would add 3.6 GB, about 12 GB in total. `master`'s own entries would
  then evict each other and every run would be cold again. That is the problem this item exists
  to solve, so a `master`-only `build` cache is not an option. Part C makes `build` fast without a
  cache instead.
- A step right after each `rust-cache` in `test` (and in the jobs part B adds) warns when nothing
  was restored. It checks whether `target/debug/deps` holds anything. The action's `cache-hit`
  output cannot be used, because it is true only for an exact key match, and a branch whose
  `Cargo.lock` changed restores a partial match. A cold leg explains a slow leg, so it should show
  in the run summary instead of being found in the log afterwards.

A1 takes effect only after one `master` run has written the entries. Until then, branches stay cold.
**No run fires on `master` by itself.** The workflow triggers only on a tag and on a dispatch, so
`master`'s cache is only as fresh as its last requested run. Requesting a run on `master` after a
merge therefore also refreshes the cache every branch starts from. An entry that is not read for
7 days is dropped by GitHub, but every branch restore counts as a read, so `master`'s entries stay
alive while branches use them.

### A2. One feature set for every cargo invocation in the job

Every `cargo test` in the `test` job uses the same package selection and features as
`Build tests`: `--workspace --all-features`, narrowed by `--test <suite>` (and by a name filter
where a step already has one, as the two `routes` steps do). Cargo accepts `--test` together with
`--workspace` and runs the suite in whichever member has it. The plan's first step checks this on
the three suites that recompiled (`connections`, `caddy`, `php_modules`) before the rest are
converted.

The Linux leg's two scripts get the same change. In the same run, `test-no-network.sh` recompiled
twice inside the namespace (29.9 s and 30.6 s), and `test-absent-secret-service.sh` recompiled for
17.7 s.

### A3. Optimise the compression code in dev builds, and pack each fixture once

In the root `Cargo.toml`:

```toml
# Tests pack and unpack real server distributions of several hundred megabytes; at opt-level 0
# the compressors, not the tests, are what the suites spend their time in (T170).
[profile.dev.package.miniz_oxide]
opt-level = 3
# … the same for flate2, crc32fast, adler2, zip, zstd-sys, zstd-safe, ruzstd, sha2
```

This covers both sides: `FakePackage` packing in the test, and the daemon unpacking and verifying.
It changes nothing in a release build. Locally, `cargo test` gets faster the same way, and
`mixengined` built for debugging unpacks a real package in seconds rather than minutes.

The suites also stop packing the same directory more than once per run. `mariadb.rs`, `mysql.rs`
and `postgres.rs` each pack the same `package()` directory into the same archive for every test
that calls `created_as`. Each suite keeps the archive in a `static OnceLock<Packed>`, so the first
test packs it and the rest, which run in parallel and wait on the lock, reuse it. The cache is
in-process, and nothing more is needed: the `services` job runs these suites under `cargo test`
(B1), where every test of a suite shares one process. Nothing about the archive's contents
changes. It is still deflated, the way `php_windows.py` packs one, because the format the suites
prove is the format that ships.

### A4. rustdoc leaves the Windows `test` leg

rustdoc stays per-OS for the reason it is today: intra-doc links under `#[cfg(windows)]` are only
checked on Windows. Where it runs depends on whether it is on the critical path:

- **On Windows** it moves to a new job, `rustdoc (windows-latest)`, with its own `rust-cache` key.
  Its check-mode artifacts are not the test build's, which is why it recompiles 48 crates today.
  It runs in parallel with `test`, so its 2.5 minutes leave the leg that was the critical path.
- **On macOS and Linux** it stays the last step of `test`, as it is today. After B2 those legs take
  about 6 minutes, so 1–2 more minutes keeps them far inside 15. A separate job there would have
  cost one of macOS's five concurrent slots (C4).

The step keeps `if: success() || failure()` in `test`. The new job does not need it: a failed test
cannot skip a job.

## Design, part B: shape the job for growth

### B1. Real-program suites move to a `services` job

The suites that need a real program (every step from `Test against a real connection` through
`Test against a real MongoDB`) move to a new job:

```yaml
services:
  name: services (${{ matrix.os }}, ${{ matrix.group }})
  strategy:
    fail-fast: false
    matrix:
      include:
        - { os: windows-latest, group: web }   # connections, Caddy, sharing, nginx, routes,
                                               # PHP-FPM, PHP ini, PHP modules, Redis, memcached, MongoDB
        - { os: windows-latest, group: sql }   # MariaDB, instances, PostgreSQL, MySQL
        - { os: macos-latest,   group: all }
        - { os: ubuntu-latest,  group: all }   # inside the network namespace, as today
```

- **Groups are a matrix field, and each step is guarded by its group** (`if: contains(fromJSON(...),
  matrix.group)` or an equivalent). A new suite joins a group. When a leg passes 15 minutes on a
  warm cache, a new group is a new `include` row plus a change to the guards, and nothing else
  moves.
- Windows is split because it is the slow OS. macOS and Linux run one leg each: their suites took
  8.5 and 6.6 minutes in 35430523430, and neither would be the longest leg of the run. Splitting
  macOS would also make one more macOS job against the free plan's five concurrent. A macOS or
  Linux `services` leg is split by the same 15-minute rule.
- Each leg fetches only the packages its group uses, and builds only the test targets its group
  runs, plus the three binaries the harness needs: `cargo test --workspace --all-features --test a
  --test b … --no-run`. It restores the `test` cache (`shared-key`) and never saves (A1).
- The Linux leg runs its suites inside the same network namespace. `test-no-network.sh` gets a mode
  argument, `workspace` or `services`, instead of being split into two scripts. The namespace setup
  and the environment forwarding list stay in one place. That list has let a green leg run nothing
  three times already.
- **The package fetch steps move from `test` to `services`.** An audit on 2026-09-19 found that
  only `#[ignore]`d suites read a package variable. That means `MIXENGINE_*_PACKAGE`,
  `MIXENGINE_PHP_RUNTIME` and `MIXENGINE_PHP_RUNTIMES`. What `runtime.rs`, `shim.rs` and
  `clients.rs` read is `MIXENGINE_PHP` and `MIXENGINE_MARIADB`: version pins the tests set
  themselves. A non-ignored test that did need a package would panic in `php_site::runtimes` or
  `frontend.rs`, so the first `test` run without the fetches checks the audit.
- **Dispatching `jobs: test` runs `test`, `services` and `rustdoc`.** No new option is added to the
  input. The input's own comment says the reason to narrow a run is one question, *is `test` green
  yet*, and after this split that answer takes all three jobs. `test` narrowed to one of them would
  give a green that answers only a third of it. To rerun only the slow part, use GitHub's *Re-run
  failed jobs*. `services` and `rustdoc (windows-latest)` therefore run when `inputs.jobs` is `''`,
  `all` or `test`.

The alternative was to build once and ship the binaries with `cargo nextest archive`. It was
rejected. The debug test binaries with debuginfo are gigabytes on Windows, uploading and downloading
them would cost about as much as a warm rebuild, and it would put every leg behind one build job.
The harness also locates `mix` through `env!("CARGO_BIN_EXE_mix")`, a path baked in at compile time,
which only survives extraction if the target directory has the same absolute path. A warm rebuild
has none of those problems.

### B2. `cargo-nextest` runs the workspace step in CI

The `Test` step (and the workspace half of `test-no-network.sh`) runs
`cargo nextest run --workspace --all-targets --all-features --profile ci` instead of `cargo test`.
Doc tests stay on `cargo test --doc`, because nextest does not run them.

- nextest runs every test as its own process, with as many running at once as the runner has
  cores. 145 binaries stop waiting on each other, and `idle.rs` stops holding up 144 others. The
  target for the Windows step is **5 minutes or less**, against 9.5 today. The plan measures it
  rather than assuming it.
- `.config/nextest.toml` holds a `ci` profile:
  - `fail-fast = false`, which replaces `--no-fail-fast` for the same reason;
  - `retries = 0`, because a retry hides the flake this repository wants to see;
  - `slow-timeout = { period = "60s", terminate-after = 5 }`, which gives a hung test a name and an
    end instead of consuming the job's 45 minutes.
- **Serialisation that relied on a process-wide `static` must be restated for nextest.**
  `crates/mixengine-platform/tests/secrets.rs` takes turns at the real credential store through a
  `static STORE: Mutex<()>`. Across processes that mutex serialises nothing. A nextest test group
  with `max-threads = 1`, applied with `binary(secrets)`, restores the guarantee. The `Mutex` stays,
  because plain `cargo test` still needs it. The plan audits every test binary for the same pattern
  (a `static` lock, a process-wide `set_var`, a shared fixed path) before the switch.
- nextest is installed by a pinned `taiki-e/install-action` step before the network is taken away,
  on all three legs.
- **Plain `cargo test --workspace` stays the contract.** `docs/standards/testing.md` gains the rule
  that a test must pass under both runners. Anything a test needs serialised is serialised in the
  test (for `cargo test`) and in `.config/nextest.toml` (for nextest), and never with a flag on one
  job. This is the rule `secrets.rs` already states for `--test-threads=1`.

### B3. Each leg reports how much of its budget it used

The last step of every leg of `test`, `services`, `rustdoc`, `bench` and `build` writes the leg's
elapsed time to the job summary. It emits a `::notice` when the leg passes its target (15 minutes,
or 20 for `build`), and a `::warning` when it passes 30 minutes, which is two thirds of the
ceiling. A leg that is growing toward the limit should say so while it is still green. The
timestamp comes from a step at the start of the job.

## Design, part C: `build` and `bench`

A branch run is only as short as its longest leg. In 35430523430 the longest legs were in these two
jobs, all cold:

| Leg | Total | Where it went |
| --- | --- | --- |
| `build (windows-11-arm)` | 28.6 min | window 12.6 → toolchain smoke test 3.2 → artifacts 10.2 |
| `build (macos-latest)` | 24.5 min | window 13.3 → artifacts 9.5 (a universal build: two targets) |
| `bench (windows-latest)` | 24.5 min | release build 11.1 → measurements 13.5 |
| `build (windows-latest)`, `build (ubuntu-22.04*)` | 18–20 min | window 8–10 → artifacts 7.5–10 |
| `bench (macos-latest)`, `bench (ubuntu-latest)` | 13–15 min | release build 6–7.5 → measurements 7 |

Splitting `build` into more jobs was rejected. After parts A and B a run holds about 23 jobs against
the free plan's 20 concurrent (5 on macOS), so the extra jobs would queue, and the queue would add
back the time the split saved.

### C1. A branch builds with a lighter release profile

`[profile.release]` sets `lto = "thin"` and `codegen-units = 1`. Those buy a smaller, faster binary
for a user, and they are the slowest settings cargo has. A branch run's `build` exists to prove
that every artifact can be packaged, installed and probed. That proof does not depend on LTO.

- On a branch, `build` sets `CARGO_PROFILE_RELEASE_LTO=false` and
  `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16` for the whole leg. On a tag it sets neither, so a release
  is built exactly as today. `mix_in_container` forwards both variables into the manylinux
  container, beside `MIXENGINE_RELEASE`. Otherwise the two Linux legs would quietly keep the slow
  profile.
- Every setting that makes an artifact a release is unchanged: `MIXENGINE_RELEASE=1`, `crt-static`
  on Windows, and `strip = "debuginfo"`.
- `bench` is not affected. It measures the profile that ships.
- The artifacts a branch uploads are not releases, and never were: only a tag run feeds `release`.
  The job summary of a branch leg says which profile built it.

What this gives up: a bug that appears only under LTO is found by the tag run instead of the branch
run. The release checklist already requires a green tag run before anything is published.

### C2. The window and the binaries build at the same time

The window (`packaging/desktop.sh`, its own Cargo workspace) and the binaries (`packaging/stage.sh`)
share nothing. Today they build one after the other. The link and LTO phases at the end of each
build leave most cores idle.

- `stage.sh` gains `--build-only`: it runs its `cargo build` with every flag it sets today, then
  exits without staging. The flags stay in one place.
- One CI step starts `desktop.sh` in the background, runs `stage.sh --build-only` in the
  foreground, and waits for both. It fails if either failed, and prints both logs under their own
  headings. The packaging steps that follow find the binaries already built, and cargo does
  nothing.
- On macOS, the build step runs `stage.sh --build-only` for both targets.
- The Windows-on-ARM smoke test (`cargo build --release -p mixengine-cli`) runs after the parallel
  step. It then checks the binary that was already built instead of building a third time.
- On the two Linux legs, each of the four packaging scripts calls `stage.sh`, and every call starts
  a new manylinux container that reinstalls `dnf` packages and a Rust toolchain. The plan measures
  what that repetition costs. If it is more than a minute, the leg stages once and the four
  scripts reuse the staged directory.

The cost is two builds competing for four cores and the runner's memory. The plan measures the
step against the sum of the two it replaces, and reverts C2 if it is not faster.

### C3. `bench` on Windows runs as two legs

The Windows measurements alone took 13.5 minutes. `bench` becomes a matrix of `os` × `group`:

| Group | Measurements | Windows time in 35430523430 |
| --- | --- | --- |
| `budgets` | Performance budgets, Cold path | 5.0 min |
| `footprint` | Idle footprint, What the tuned defaults save, M3 three services warm | 6.8 min |

Only Windows is split. macOS and Linux keep one leg (`group: all`), because their 7 minutes of
measurements plus a warm build fit inside 15. Each Windows leg builds only what its measurements
need: `fakeservice` only in `budgets`, and `mixengined` in both. It reads the `bench` cache, which
`master` still writes. The step guards follow B1's pattern. Nothing that is measured changes, and
neither does the profile it is measured under.

### C4. rustdoc does not cost a macOS slot

This is folded into A4 above: rustdoc is a separate job only on Windows. Otherwise a run would hold
six macOS jobs (`test`, `services`, `rustdoc`, `system`, `bench`, `build`) against five
concurrent, and one of them would wait for a slot.

## Design, part D: what Windows costs

Windows took 2 to 6 times as long as the other two systems for the same work in 35430523430:
`Build tests` 499 s against 212–227 s, the workspace run 593 s against 238 s, MySQL 276 s against
42 s. **Windows Defender is not the reason.** The runner image turns off real-time monitoring and
excludes `C:\` and `D:\` (`images/windows/scripts/build/Configure-WindowsDefender.ps1` in
`actions/runner-images`). What is left:

- the MSVC linker writing PDBs for about 150 debug test binaries;
- `CreateProcess` and NTFS small-file operations, which a harness that starts `mix`,
  `mixengined` and `fakeservice` and copies binaries into a home per test pays for over and over;
- the zip fixtures (A3);
- the servers' own first-run rituals on Windows.

### D1. Every Windows leg records Defender's state

The image's settings are a promise about today's image, not a property of the runner. Each Windows
leg of `test` and `services` gets one step, next to the T2b assertion, that prints
`Get-MpComputerStatus`'s `RealTimeProtectionEnabled`, `AntivirusEnabled` and `AMRunningMode`
fields and `Get-MpPreference`'s `ExclusionPath`. It emits a `::warning` when real-time protection
is on. It is a warning and not a failure, because Defender on is a slower runner, not a wrong
result. Then, the next time Windows is slower than usual, the log already says whether Defender
was involved.

### D2. Debug builds in CI carry line tables only

The workflow's top-level `env` sets `CARGO_PROFILE_DEV_DEBUG=line-tables-only`, and `profile.test`
inherits it. A backtrace from a failing test still names files and lines. What it loses is
variable and type information, which nobody reads from a CI log. On Windows the linker writes far
smaller PDBs for every one of the ~150 test binaries. `Build tests` there is expected to shrink by
20–30%, and the plan measures it.

It is set once for the whole workflow, not per job, for a reason about the cache. `rust-cache`
hashes the `CARGO_*` environment into its key, and `test` and `services` share one entry (B1). A
variable set on one job only would give the two jobs different keys, and `services` would always
build cold. Release builds (`bench`, `build`) are unaffected, because the variable names the `dev`
profile. Developers' machines are unaffected too: this lives in CI, not in `Cargo.toml`.

## Expected result (to be measured)

Windows:

| Leg | Warm cache | Cold cache |
| --- | --- | --- |
| `test` (build, nextest, doc tests, cache save on `master`) | ~11 min | ~17 min |
| `services (windows, sql)` (fetch, partial build, 4 suites after A3) | ~11 min | ~15 min |
| `services (windows, web)` | ~10 min | ~14 min |
| `rustdoc (windows)` | ~3 min | ~5 min |
| `bench (windows, budgets)` | ~10 min | ~16 min |
| `bench (windows, footprint)` | ~12 min | ~18 min |

macOS and Linux, warm. Both took about 20 and 18 minutes in 35430523430, cold:

| Leg | macOS | Linux |
| --- | --- | --- |
| `test` (with rustdoc) | ~7–8 min | ~7–8 min |
| `services` | ~11–12 min | ~8–9 min |
| `bench` | ~11 min | ~10 min |

`build`, which is always cold (A1), on a branch run after C1 and C2:

| Leg | Before | After |
| --- | --- | --- |
| `build (windows-11-arm)` | 28.6 min | ~17–18 min |
| `build (macos-latest)` | 24.5 min | ~16–17 min |
| `build (windows-latest)` | 20.0 min | ~13–14 min |
| `build (ubuntu-22.04)`, `(ubuntu-22.04-arm)` | 18–19 min | ~11–13 min |

The run's wall time becomes the longest of these, instead of their sum: about 18 minutes, set by
`build (windows-11-arm)`. Every other leg is inside 15.

## Rollout

Each step is its own commit and its own dispatched CI run, and each result is compared with
35430523430:

1. A1. It reaches `master`, and a `master` run writes the new entries. Then a branch run confirms
   that it restores them.
2. A2, then A3, then A4. The per-step times of each run are compared with the tables above.
3. B1, then B2, then B3.
4. C1, then C2, then C3. C1 and C2 are measured separately, because C2's gain depends on how much
   of the build C1 leaves.
5. D1, then D2. D2's gain is measured on `Build tests`.

A step whose run shows no gain is reverted or explained in this spec's plan. It is not kept because
the reasoning said it would help.

## Documentation

- `.github/workflows/ci.yml`: the comments on the jobs it touches, including the rationale on the
  `test` timeout, which gets the budget from this spec.
- `docs/operations/build-and-release.md`: the CI section describes `services`, `rustdoc`, the two
  Windows `bench` legs, and that a branch's `build` uses the lighter profile (C1) while a tag's
  does not; *Packaging* documents `stage.sh --build-only` (C2).
- `docs/standards/testing.md`: the two-runners rule from B2, and "a real-program suite joins a
  `services` group" where it describes adding one.
- `CLAUDE.md`, *Common commands*: `cargo nextest run` as an optional faster local runner, beside
  `cargo test`, not instead of it.

## Risks

- **The quota can fill up again.** New jobs and larger builds grow `master`'s set. The A1 warning
  makes a cold leg visible the first time it happens, and the size table above is the baseline to
  compare against.
- **More concurrent jobs.** A run grows from 18 jobs to about 23: `services` ×4, `rustdoc` ×1 and
  one more `bench` leg. On the free plan's 20 concurrent jobs, a few queue briefly at the start of
  a run. They queue, they do not fail, and the short ones (`lint`, `docs`, `bindings`, `rustdoc`)
  free their slots within minutes. macOS holds exactly five jobs, its limit.
- **C1 hides an LTO-only bug until the tag.** That is accepted in C1, and the release checklist is
  what catches it.
- **nextest shows a hidden dependency between tests.** That is a finding, not a regression. The
  plan fixes it in the test, or declares it in `.config/nextest.toml` as B2 describes, before the
  switch lands.
- **Opt-level overrides lengthen a clean dev build** by the time it takes to optimise nine small
  crates, which is measured in seconds.

## Decisions

Agreed 2026-09-19. These were open questions in the draft.

1. **`build` does not cache, on `master` or anywhere else.** The quota arithmetic in A1 leaves no
   room for it.
2. **macOS and Linux keep one `services` leg each.** They are split when a leg passes 20 minutes
   (B1).
3. **`jobs: test` runs `test`, `services` and `rustdoc`,** and the dispatch input gains no option
   (B1).
4. **Part C is part of T170** (2026-09-19): C1 lighter branch profile, C2 parallel window and
   binaries, C3 Windows `bench` in two legs, C4 rustdoc as a job only on Windows.
5. **No paid cache storage.** `build` therefore targets 20 minutes rather than 15.
6. **Part D is part of T170** (2026-09-19): D1 records Defender's state on every Windows leg, and D2
   builds CI's debug profile with line tables only.

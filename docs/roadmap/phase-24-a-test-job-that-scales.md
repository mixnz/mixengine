# Phase 24 — A test job that scales

*Goal: waiting for a branch run takes 15 minutes or less, and a new real-program suite adds a
parallel leg rather than serial minutes.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-19-t170-a-test-job-that-scales-design.md](../specs/2026-09-19-t170-a-test-job-that-scales-design.md),
then [2026-09-20-t171-a-build-that-fans-out-design.md](../specs/2026-09-20-t171-a-build-that-fans-out-design.md) for `build`.

---

- [x] **T170a** `master` writes the Actions cache and branches only read it; `build` stops caching;
      a leg that restored nothing says so.
- [x] **T170b** Every cargo invocation in `test` uses `Build tests`' selection and features, so no
      suite step recompiles a dependency.
- [x] **T170c** The compression and hashing crates are optimised in dev builds, and each DB suite
      packs its fixture once.
- [x] **T170d** rustdoc moves to a job of its own on Windows, and stays the last step of `test` on
      macOS and Linux.
- [x] **T170e** The real-program suites move to a `services` job, grouped by a matrix field;
      Windows split in two. **(P)**
- [x] **T170f** The workspace step runs under `cargo-nextest` in CI, with a `ci` profile and the
      serialisation `secrets.rs` needs; plain `cargo test` stays the contract. **(P)**
- [x] **T170g** Every leg of `test`, `services`, `rustdoc`, `bench` and `build` reports its elapsed
      time, with a notice past its target and a warning past 30 minutes.
- [x] **T170h** A branch's `build` uses a lighter release profile (no LTO, 16 codegen units); a
      tag's builds exactly as before.
- [x] **T170i** ~~`build` compiles the window and the binaries at the same time~~ — **measured and
      withdrawn**: run 35453209479 took 31.1 minutes on `macos-latest` and 21.7 on `windows-latest`
      for the parallel step, against 22.7 and 17.4 for the whole sequential job before. See the spec, C2.
- [x] **T170j** `bench` on Windows runs as two legs, `budgets` and `footprint`. **(P)**
- [x] **T170k** Every Windows leg of `test` and `services` records Defender's state, and warns when
      real-time protection is on.
- [x] **T170l** CI's debug builds carry line tables only (`CARGO_PROFILE_DEV_DEBUG`), set once for the
      whole workflow.
- [x] **T171a** `packaging/stage.sh` can compile only (`--build-only`) or stage only
      (`MIX_PREBUILT=1`), so the two halves can run in different jobs.
- [x] **T171b** Every `build` leg runs as `window` and `binaries` in parallel, then `build` packages
      what they handed on; `release` downloads `mixengine-*` only.
- [x] **T171c** On a branch, macOS builds the aarch64 slice alone and still checks x86_64; `master`
      and tags stay universal.
- [ ] **T183** **(P)** A build that is not a release keeps its own credentials: a development
      daemon's `keyring()` is a file in its home, so a test run never stops for a Keychain password
      dialog and never reads another home's credential through T126's fallback — ADR 0051,
      [design](../specs/2026-09-24-a-build-that-is-not-a-release-keeps-its-own-credentials-design.md).

**Milestone M24**: in a warm branch run, every leg of every job finishes in 15 minutes or less
except `build`, whose legs finish in 20 or less, and no leg passes 30 minutes — **met**, measured on
2026-09-20 by run 35481399561: a full request on a throwaway branch off `master` (`e98bf944`), on the
cache run 35477364909 had just written. Thirty-four jobs green, 18.4 minutes of wall time against
33.4 for the last full run on `master`, which still builds macOS universal.

| | Longest leg | |
| --- | --- | --- |
| any job | `bench (windows-latest, footprint)` | 14.9 min |
| `build` | `build / window (macos-latest)` | 14.2 min |
| for comparison | `build / window (windows-latest)`, the long pole through T170 | 13.8 min |

The first row clears its threshold by six seconds. The next leg that drifts fails M24 without
anything having regressed, so treat that number as the one to watch — and `bench`, not `window`, is
now where the next minute is.

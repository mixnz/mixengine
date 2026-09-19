# Phase 24 — A test job that scales

*Goal: waiting for a branch run takes 15 minutes or less, and a new real-program suite adds a
parallel leg rather than serial minutes.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-19-t170-a-test-job-that-scales-design.md](../specs/2026-09-19-t170-a-test-job-that-scales-design.md).

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

**Milestone M24**: in a warm branch run, every leg of every job finishes in 15 minutes or less
except `build`, whose legs finish in 20 or less, and no leg passes 30 minutes.

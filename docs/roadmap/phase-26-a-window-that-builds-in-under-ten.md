# Phase 26 — A window that builds in under ten

*Goal: the longest leg of `build` finishes in ten minutes, without a cache and without changing
what a tag builds.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t173-a-window-that-builds-in-under-ten-design.md](../specs/2026-09-20-t173-a-window-that-builds-in-under-ten-design.md).

---

- [x] **T173a** `.github/actions/release-profile` sets `CARGO_PROFILE_RELEASE_OPT_LEVEL=0` on any
      ref that is not a tag, and says so in the step summary. Level 1 was measured first and moved
      only `binaries`; `mixlab` is one crate of 306 s of codegen that level 1 barely touches.
- [x] **T173b** The Windows legs of `window` and `binaries` exclude the workspace and `CARGO_HOME`
      from Defender, report what they did, and never fail on a refusal.
- [x] **T173c** A branch run produces cargo's `--timings` report for the window as an artifact,
      behind the `MIX_TIMINGS` repository variable. **`rust-lld` is not adopted**: the report says
      `mixlab` is 306.3 s of codegen and 4.4 s of link, so there is no link time to take.

**Milestone M26** — **met**, measured by run 35489039746 against baseline 35481399561: in a warm
branch run `window (windows-latest)` finished in **9.1 minutes** (7.1 in a `jobs=build` run), 34
jobs green, and the fifteen artifact names identical. The whole `build` group went from 111.2
leg-minutes to 77.1, its slowest leg from 14.2 to 10.6.

Two numbers the milestone does not cover, recorded because they are the price: the five packaging
legs cost **5.5 leg-minutes more** for artifacts 16–76% bigger, and that run's wall clock was 21.1
against 18.4 — the difference being 5.6 minutes a `windows-11-arm` runner took to appear, not
anything this phase changed.

**The debt this phase leaves.** Four axes now separate a branch build from a release build — the
cache (T170a), LTO (T170h), the macOS slices (T171c, and `master` covers that one) and optimisation
level (T173a) — and nothing that runs regularly builds what a release actually ships. T174 is that
rehearsal, and it belongs before the next tag.

# Phase 27 — A rehearsal of the release build

*Goal: the configuration a release is built with is built regularly, so a tag is never the first
time it is compiled.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t174-a-rehearsal-of-the-release-build-design.md](../specs/2026-09-20-t174-a-rehearsal-of-the-release-build-design.md).

---

- [ ] **T174a** `ci.yml` gains a `profile` input (`branch` | `release-exact`), passed to
      `_build.yml`; `release-profile` builds a tag's profile when asked for `release-exact` on any
      ref, and says which profile it chose in the step summary.
- [ ] **T174b** `.github/workflows/release-rehearsal.yml` runs that build weekly on `master`, and
      can be dispatched on its own. It calls `_build.yml`; it does not duplicate a step of it.
- [ ] **T174c** The release checklist in `docs/operations/build-and-release.md` requires a green
      rehearsal before a tag is created, says what to read in it, and says what to do when GitHub
      has disabled the schedule.
- [ ] **T174d** The first rehearsal is run, and its numbers — every `build` leg's wall clock against
      its timeout, and the size of each installer — are recorded here beside M26's.

**Milestone M27**: a `release-exact` run on `master` builds every `build` leg green and inside every
timeout, it happens weekly without anybody asking, and the release checklist names it as a step
before tagging.

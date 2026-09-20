# Phase 27 — A rehearsal of the release build

*Goal: the configuration a release is built with is built regularly, so a tag is never the first
time it is compiled.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t174-a-rehearsal-of-the-release-build-design.md](../specs/2026-09-20-t174-a-rehearsal-of-the-release-build-design.md).

---

- [x] **T174a** `ci.yml` gains a `profile` input (`branch` | `release-exact`), passed to
      `_build.yml`; `release-profile` builds a tag's profile when asked for `release-exact` on any
      ref, and says which profile it chose in the step summary.
- [x] **T174b** `.github/workflows/release-rehearsal.yml` runs that build weekly on `master`, and
      can be dispatched on its own. It calls `_build.yml`; it does not duplicate a step of it.
- [x] **T174c** The release checklist in `docs/operations/build-and-release.md` requires a green
      rehearsal before a tag is created, says what to read in it, and says what to do when GitHub
      has disabled the schedule.
- [x] **T174d** The first rehearsal is run, and its numbers — every `build` leg's wall clock against
      its timeout, and the size of each installer — are recorded here beside M26's.

**Milestone M27** — **met in two of its three halves**, by run 35491317573, the first build of the
release configuration since T170h took LTO off a branch three weeks ago. Fifteen `build` legs green,
and the answer to the question that mattered: **LTO links.**

| Leg | At the release profile | Its timeout | Off a tag, for comparison |
| --- | --- | --- | --- |
| `window (macos-latest)` | **22.7** | 45 | 10.9 on `master`, universal |
| `window (windows-11-arm)` | 15.0 | 45 | 9.9 |
| `window (windows-latest)` | 14.6 (cargo: 12m 56s) | 45 | 8.7 |
| `binaries (macos-latest)` | 10.7 | 45 | — |
| the five packaging legs | 0.9 to 3.4 | 30 | — |

The widest leg uses half its timeout, so `codegen-units = 1` has room. What a release weighs, which
nothing had measured either:

| | A release | A branch build (opt-level 0) |
| --- | --- | --- |
| `mixengine-windows-latest` | 138 MB | 178 MB |
| `mixengine-macos-latest` | 253 MB | 524 MB |
| `mixengine-ubuntu-22.04` | 266 MB | 461 MB |

**The third half is not met yet and cannot be until this lands.** A GitHub schedule runs the
workflow as it stands on the default branch, so the weekly rehearsal begins only once
`release-rehearsal.yml` is on `master`. The first Monday after that proves it; if nothing appears
that morning, the schedule is wrong and this milestone is not met.

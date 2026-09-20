---
status: draft
date: 2026-09-20
task: T174
---

# T174 — A rehearsal of the release build

Four axes now separate what CI builds every day from what a release ships, and each was argued and
measured on its own:

| Axis | Off a tag | On a tag | Covered by |
| --- | --- | --- | --- |
| Actions cache (T170a) | branches read `master`'s | the same | nothing needed — a cache changes no output |
| LTO, codegen units (T170h) | off, 16 | `thin`, 1 | **nothing** |
| macOS slices (T171c) | `aarch64` alone off `master` | universal | `master`, every merge |
| Optimisation level (T173a) | 0 | 3 | **nothing** |

The problem is not any one row. It is the last column: **the configuration a release is built with
is now the least-exercised configuration in this project**, and the one run that does build it is
the run that must not fail — a cancelled or red release run leaves a half-uploaded draft, which
`ci.yml`'s own concurrency comment calls the one state that pipeline has no answer for.

This is how every large project works, and it is also where they differ from this one. Rust's PR CI
does not build with LTO, PGO or BOLT; those belong to `dist`. Firefox's try builds are not PGO
builds. Chromium's commit queue is not the official builder. What they all have that this
repository does not is **a regular, independent build of the real configuration** — a nightly, a
canary, a dist build on every merge. A release there is never the first time that configuration was
compiled this month.

## What this adds

**One input, and one line in the checklist.** `ci.yml` gains `profile`, a choice between `branch`
(what every run does today, the default) and `release-exact`. `release-profile` honours it: asked
for `release-exact` on any ref, it writes nothing into the environment and says so in the step
summary, which is exactly what it already does on a tag.

Then a rehearsal is one dispatch:

```bash
gh workflow run ci.yml --ref master -f jobs=build -f profile=release-exact
```

## D1 — An input to ask with, and a workflow of its own to schedule it

Both, and they are not the same mechanism.

**The input** is how a person asks: before a tag, or on a branch that changes how a release is
built. **A schedule** is what stops the asking from being forgotten, and it lives in
`.github/workflows/release-rehearsal.yml` — its own file, with its own `on: schedule`, calling
`_build.yml` with the two inputs it needs.

**Not a `schedule:` in `ci.yml`**, for two reasons. The first is a fact about this repository: with
a `schedule` event `inputs.jobs` is empty, and empty is the arm `ci.yml` wrote for a tag push — so a
scheduled run there would quietly start all thirty-four jobs rather than the `build` group.
The second is that `ci.yml` says of itself that every run is asked for; a trigger nobody asked for
does not belong in the file T172 spent a phase making readable. A separate file states its own
purpose in its own name.

What a GitHub schedule is worth knowing about, since it is the insurance and not the thing insured:
it runs the workflow **as it stands on the default branch** and reports `refs/heads/master`, it is
late under load and occasionally skipped, and GitHub disables it after 60 days without repository
activity. The checklist line (T174c) therefore stays: the cron is what makes forgetting unlikely,
not what makes it impossible.

## D2 — `release-exact` means exactly the tag's build, on any ref

Not "closer to release". The same code path a tag takes, reached from a branch: no LTO override, no
codegen-units override, no optimisation-level override, and the macOS slice set a tag builds. One
`if` in `release-profile` covers all four, because all four already hang off the same condition.

The rehearsal is run on `master`, and nothing stops it being run on a branch that is about to
change how a release is built — which is the other time this is worth having.

## D3 — What the rehearsal is looking for

Three answers nothing else in CI can give:

1. **Does it build at all?** LTO fails at link, not at compile: a duplicate symbol or an
   out-of-memory in the linker is invisible to every run that has LTO off.
2. **Does it fit the timeout?** `window` allows 45 minutes and `binaries` its own budget. At
   `codegen-units = 1` and `opt-level = 3` nobody has measured either since T170h, and a release
   that fails on a timeout fails after paying for the whole run.
3. **What does a release actually weigh and cost?** The numbers go in the roadmap beside M26's, so
   the next person arguing about a profile argues from both.

## What does not change

- Every ordinary run: `profile` defaults to `branch`, and an omitted input is the same as today.
- A tag: it never reads the input, because `refs/tags/*` already takes the unchanged path.
- `ci.yml` keeps its two triggers. The schedule is another file's.
- T170a, T170h, T171c, T173a: this spec rehearses them, it does not revisit them.

## The tasks

- **T174a** `ci.yml` gains a `profile` input (`branch` | `release-exact`), passed to `_build.yml`;
  `release-profile` builds a tag's profile when asked for `release-exact` on any ref, and says
  which profile it chose in the step summary.
- **T174b** `.github/workflows/release-rehearsal.yml` runs that build weekly on `master`, and can be
  dispatched on its own. It calls `_build.yml`; it does not duplicate a step of it.
- **T174c** The release checklist in `docs/operations/build-and-release.md` requires a green
  rehearsal before a tag is created, says what to read in it, and says what to do when the schedule
  has not run because GitHub disabled it.
- **T174d** The first rehearsal is run, and its numbers — every `build` leg's wall clock against its
  timeout, and the size of each installer — are recorded beside M26 in the phase file.

**Milestone M27**: a `release-exact` run on `master` builds every `build` leg green and inside every
timeout, it happens weekly without anybody asking, and the release checklist names it as a step
before tagging.

## Accepted costs

**E1 — A schedule can be disabled without anybody being told.** Sixty days of repository inactivity
turns it off, and nothing announces that. The checklist is the backstop: it asks for a rehearsal
whose run is recent, not merely for one that exists somewhere in the history.

**E3 — A weekly `build` group costs runner minutes for a week in which nothing changed.** About
twenty minutes of wall clock and the leg-minutes of ten build legs, against the cost of learning at
tag time that LTO does not link. Weekly rather than nightly is where that trade was set; a month
without a release is a reason to lengthen it, not to remove it.

**E2 — The rehearsal is not the release.** It does not sign, does not upload a draft, and does not
exercise `release`'s own job. It answers "does this build", not "does this ship", and the tag run
remains the only thing that answers the second.

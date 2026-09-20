---
status: implemented
date: 2026-09-20
task: T173
---

# T173 — A window that builds in under ten minutes

M24 is met, and `build` is no longer the group anyone waits for by name. One leg still costs more
than any other: `window (windows-latest)`, and every minute of it is on `build`'s path — `build`
waits for the whole `window` matrix before it packages anything (T171, E1). This spec is about that
leg. **Nothing a tag builds changes.**

## What this leg costs, and why one number was not enough

**The first draft of this spec called the baseline 13.8 minutes, from run 35481399561. That was the
lowest of eleven samples.** Read back across the runs that preceded this work, the leg is bimodal —
the same commit lands on a fast or a slow host and the two clusters are four and a half minutes
apart, which is twice what any change here set out to save:

| 18.5 | 18.5 | 18.4 | 18.3 | 18.3 | 18.2 | 18.2 | 18.0 | 17.5 | 15.0 | 13.8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Nine of eleven sit between 17.5 and 18.5, so **17.5–18.5 is the baseline and a single sample decides
nothing on this leg.** `binaries (windows-latest)` has no such spread (10.4–11.6 over ten runs) and
is the leg to read a small change on. This is the same lesson `bench`'s warm start taught on ubuntu:
a red number is not a regression until the distribution says so.

The breakdown below is from run 35481399561, the fast-host sample, and the proportions hold in the
slow ones.

| Step | Minutes |
| --- | --- |
| checkout, toolchain, setup-node, tar, upload — all of them together | 0.7 |
| `Build the window` (`bash packaging/desktop.sh`) | **13.1** |

Inside that step, from the timestamps in its own log:

| | |
| --- | --- |
| `npm ci` | 5 s |
| `tsc -b && vite build` | 30 s |
| cargo downloading 300-odd crates | 73 s |
| compiling 530 dependency crates | 5 min 06 |
| the workspace crates, `mixlab`, and the link | 6 min 09 |

`Finished release profile [optimized] target(s) in 12m 35s`.

The second half is the surprise. From `Compiling mixengine-platform` to `Finished` is 5 min 54 with
three crates left to build, so nearly half the job is one crate's codegen and one link.
`codegen-units = 16` buys nothing there, and neither would more cores.

## What is already true, and stays true

- **This job has no Actions cache, deliberately (T170a).** Its release artifacts and `binaries`' run
  to several GB; cached, one `master` run would write more than the repository's 10 GB and evict its
  own entries. Nothing here reopens that.
- **A branch already builds without LTO, with 16 codegen units (T170h)**, because a branch's
  artifacts prove that everything packages, installs and answers a probe — not how fast it runs.
- **Only `build` and `release` consume these artifacts.** `bench` compiles its own release binaries,
  and `.github/actions/release-profile` is used by `_build.yml` and by nothing else. That was
  checked rather than assumed: a profile change that reached `bench` would move its numbers, and its
  `footprint` leg measures a binary's size.

## D1 — Any ref that is not a tag builds at `opt-level = 0`

`CARGO_PROFILE_RELEASE_OPT_LEVEL=0`, written by `.github/actions/release-profile` beside the two
variables it already writes, on the same condition: not a tag.

This is T170h's argument one step further, and it is the same argument. What a branch's `build`
proves is that `stage.sh` packages what `window` and `binaries` handed it, that the installer
installs, and that every probe answers — none of which depends on how well the optimiser did. The
tag run builds `[profile.release]` exactly as `Cargo.toml` states it, and the release checklist
requires that run to be green before anything ships.

**Level 1 was measured first, and 0 is what the numbers chose.** At `opt-level = 1` the five
`binaries` legs fell about 9% — `binaries (windows-latest)` to 9.5–10.2 minutes from a 10.4–11.6
band — while the five `window` legs did not move at all, `mixlab` being one crate whose codegen the
level barely touched at 1. At 0 the same leg is **4.0 minutes and `window (windows-latest)` is 7.1**,
against 17.0 twice at level 1 and a 17.5–18.5 baseline.

| Leg | baseline | opt-level 1 | opt-level 0 |
| --- | --- | --- | --- |
| `window (windows-latest)` | 17.5–18.5 | 17.0, 17.0 | **7.1** |
| `window (macos-latest)` | 14.2 | 15.3 | 6.8 |
| `window (ubuntu-22.04)` | 11.5 | 8.5 | 5.9 |
| `binaries (windows-latest)` | 10.4–11.6 | 9.5, 10.1, 10.2 | 4.0 |
| a whole `jobs=build` run | — | 21.0 | 15.0 |

## D2 — The Windows legs take the workspace out of Defender's way

On `windows-latest` and `windows-11-arm`, in `window` and in `binaries`, exclude the workspace and
`CARGO_HOME` from real-time scanning before the build, and say in the log what was excluded — or
that the exclusion was refused.

T170k already has these runners report Defender's state in `test` and `services`, on the reasoning
that an antivirus reading every object file is a cost nobody can see in a wall-clock number. In
`window` it is not even reported. A build that writes tens of thousands of files into `target/` is
the case this helps most.

**It must never fail the job.** `Add-MpPreference` needs a privilege the runner may not grant; a
refusal prints a notice and the build goes on.

## D3 — `rust-lld` was measured, and is not adopted

If the tail were mostly the link, a faster linker would be worth more than any profile change; if it
were codegen, it would be worth nothing. Nobody knew which, so the first act was a measurement:
`MIX_TIMINGS=1` in `desktop.sh` forwards `--timings` to cargo — `tauri build` passes what follows a
second `--` to the runner — and CI turns it on through a repository variable, so measuring costs no
commit in either direction.

**The report settled it.** Of a 15.6-minute cargo graph over 908 units:

| `mixlab`, one unit | **306.3 s** |
| --- | --- |
| linking the `mixlab` binary | **4.4 s** |
| `mongodb` | 112.5 s |
| `windows 0.61.3` | 75.5 s |
| `tauri-utils` | 67.5 s |
| `sqlx-postgres` | 66.5 s |

The tail is one crate's codegen and the link is four seconds, so `rust-lld` is dropped: it cannot
reach the number. The report stays reachable for the next person to ask a different question of it.

What the same report shows is where the remaining minutes are, and neither is CI's to take: 624
seconds of dependencies before `mixlab` starts, and 306 seconds of `mixlab` itself, whose front end
is single-threaded and whose `codegen-units` do not divide it. Cutting those means fewer or lighter
dependencies in `apps/desktop/src-tauri` — a product change, with a spec of its own.

## How each change is judged

**Not against one run.** The leg is bimodal (see above), so a single sample cannot see a change
smaller than four minutes on it. A change is read on `binaries (windows-latest)`, whose ten-run band
is 10.4–11.6, and on the five `window` legs together; `window (windows-latest)` is accepted only
when a change is large enough to leave the baseline band entirely, as `opt-level = 0` did at 7.1.

`build`'s own legs and the artifact names are read back too: 34 jobs, the same artifact list, every
probe green. A faster build that ships a different artifact is not a faster build.

## What must not change

- A tag builds exactly `[profile.release]`: LTO, `codegen-units = 1`, `strip`, `crt-static`,
  `MIXENGINE_RELEASE`, the macOS universal slices.
- Artifact names, the tar layout, and what `build` probes.
- T170a: no Actions cache in `window` or `binaries`.

## The tasks

- **T173a** `.github/actions/release-profile` sets `CARGO_PROFILE_RELEASE_OPT_LEVEL=0` on any ref
  that is not a tag, and says so in the step summary.
- **T173b** The Windows legs of `window` and `binaries` exclude the workspace and `CARGO_HOME` from
  Defender, report what they did, and never fail on a refusal.
- **T173c** A branch run produces cargo's `--timings` report for the window as an artifact, behind a
  repository variable; `rust-lld` is adopted only if that report names the link.

**Milestone M26**: in a warm branch run, `window (windows-latest)` finishes in 10 minutes or less,
and `build` produces the same artifacts, with the same probes green, as run 35481399561.

## Accepted costs

**E1 — A branch's artifacts differ from a release's in one more way.** They already differ by LTO
and codegen units; optimisation level joins that list. The mitigation is unchanged and is the one
the release checklist already relies on: the tag run builds the real profile and must be green.

**E2 — An optimisation-level-dependent bug would be found later.** A miscompilation or an
overflow that only appears at `opt-level = 3` would reach the tag run rather than a branch run. This
is the same exposure LTO already has, on a build nobody ships.

**E4 — A branch's artifacts are bigger, and slow to run.** At `opt-level = 0` the installers grew by
16 to 76% — `mixengine-ubuntu-22.04-arm` from 308 MB to 542, `mixengine-windows-latest` from 153 to
178 — and the upload did not take the saving back: `build (windows-latest)` went 2.0 to 2.1 minutes.
The cost that is not measured in minutes is that `window-<os>` is kept fourteen days *so somebody
can try the window without an installer*, and what they would now try is an unoptimised build. That
is the price of eleven minutes a run, and it is paid only off a tag.

**E3 — The Defender exclusion may be refused, and then D2 buys nothing.** That is why it prints what
happened: an exclusion that silently did not apply would make the next measurement a lie.

---
status: approved
date: 2026-09-20
task: T173
---

# T173 — A window that builds in under ten minutes

M24 is met, and `build` is no longer the group anyone waits for by name. One leg still costs more
than any other: `window (windows-latest)`, 13.8 minutes of an 18.4-minute run, and every minute of
it is on `build`'s path — `build` waits for the whole `window` matrix before it packages anything
(T171, E1). This spec is about that leg. **Nothing a tag builds changes.**

## What the 13.8 minutes are

Run 35481399561: a full request on a throwaway branch off `master` (`e98bf944`), on the cache
`master` had written an hour before.

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

## D1 — Any ref that is not a tag builds at `opt-level = 1`

`CARGO_PROFILE_RELEASE_OPT_LEVEL=1`, written by `.github/actions/release-profile` beside the two
variables it already writes, on the same condition: not a tag.

This is T170h's argument one step further, and it is the same argument. What a branch's `build`
proves is that `stage.sh` packages what `window` and `binaries` handed it, that the installer
installs, and that every probe answers — none of which depends on how well the optimiser did. The
tag run builds `[profile.release]` exactly as `Cargo.toml` states it, and the release checklist
requires that run to be green before anything ships.

It should cut both halves of the build, the 530 dependency crates and the `mixlab` tail, which is
what makes it the first thing to try rather than the third.

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

## D3 — `rust-lld` is measured before anything adopts it

If the 5 min 54 tail is mostly the link, a faster linker is worth more than any profile change; if
it is codegen, it is worth nothing. Today nobody knows which, so the first act is a measurement, not
a change:

1. One branch run produces `cargo`'s `--timings` report for `apps/desktop/src-tauri` and uploads it
   as an artifact. `cargo tauri build` forwards what follows `--` to cargo, so `--timings` can reach
   it; if that turns out not to hold, a `cargo build --timings` step on that one leg answers the same
   question. `desktop.sh` gains an opt-in (`MIX_TIMINGS=1`), not a permanent flag.
2. Only if the report says *link*, try `rust-lld` on the Windows legs, on refs that are not tags.
   Which flag the pinned toolchain accepts — `-C linker-features=+lld`, or `rust-lld` named as the
   linker — is part of the measurement; this spec does not guess it.

**The bar for adopting it:** at least one minute off `window (windows-latest)`, and `build` still
packages and probes every artifact. Below that bar it is not worth a second linker in the toolchain.

## How each change is judged

Against run 35481399561, job `window (windows-latest)`: **13.8 minutes, of which the build step is
13.1 and cargo reports 12m 35s.** One branch run per change, the same three numbers read back from
the same job. A change that does not show in them is reverted, as T170i and T171's job reorder were.

`build`'s own legs and the artifact names are read back too: 34 jobs, the same artifact list, every
probe green. A faster build that ships a different artifact is not a faster build.

## What must not change

- A tag builds exactly `[profile.release]`: LTO, `codegen-units = 1`, `strip`, `crt-static`,
  `MIXENGINE_RELEASE`, the macOS universal slices.
- Artifact names, the tar layout, and what `build` probes.
- T170a: no Actions cache in `window` or `binaries`.

## The tasks

- **T173a** `.github/actions/release-profile` sets `CARGO_PROFILE_RELEASE_OPT_LEVEL=1` on any ref
  that is not a tag, and says so in the step summary.
- **T173b** The Windows legs of `window` and `binaries` exclude the workspace and `CARGO_HOME` from
  Defender, report what they did, and never fail on a refusal.
- **T173c** A branch run produces cargo's `--timings` report for the window as an artifact;
  `rust-lld` is adopted only if that report names the link and it meets the bar in D3.

**Milestone M26**: in a warm branch run, `window (windows-latest)` finishes in 10 minutes or less,
and `build` produces the same artifacts, with the same probes green, as run 35481399561.

## Accepted costs

**E1 — A branch's artifacts differ from a release's in one more way.** They already differ by LTO
and codegen units; optimisation level joins that list. The mitigation is unchanged and is the one
the release checklist already relies on: the tag run builds the real profile and must be green.

**E2 — An optimisation-level-dependent bug would be found later.** A miscompilation or an
overflow that only appears at `opt-level = 3` would reach the tag run rather than a branch run. This
is the same exposure LTO already has, on a build nobody ships.

**E3 — The Defender exclusion may be refused, and then D2 buys nothing.** That is why it prints what
happened: an exclusion that silently did not apply would make the next measurement a lie.

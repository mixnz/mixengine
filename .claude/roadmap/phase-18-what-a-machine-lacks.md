# Phase 18 — What a machine lacks

*Goal: the daemon reads what an artifact requires of the machine before it downloads anything,
installs what can be installed once somebody has agreed to it, and names the version that does run
when nothing can be.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-16-t148-what-a-machine-lacks-is-installed-not-reported-design.md](../../docs/superpowers/specs/2026-09-16-t148-what-a-machine-lacks-is-installed-not-reported-design.md).

---

**The case this comes from**: a Windows machine with no Visual C++ runtime, and somebody who opens
the window to get a PHP. MixEngine downloads it, unpacks it, runs `php -v` from staging, and reports
that the loader could not find `VCRUNTIME140.dll` — true, and the end of the road. The index said so
before the first byte moved: every Windows PHP from 7.0 to 8.5 carries a `requires.vcredist`, and
T92 recorded that nothing in this workspace reads it.

What the person wanted was a PHP that runs. **For the Visual C++ runtime that is reachable** — one
Microsoft installer, *Visual C++ 2015–2022 Redistributable (x64)*, satisfies 21 of the 22 Windows
artifacts the published index says need a runtime. **For glibc and macOS it is not**, because each
is the operating system itself; but a dead end is still avoidable, because an older build of the same
runtime usually runs.

`SmokeTest` stays in front of every install. This phase puts a prediction ahead of it, and the proof
stays where it is.

## The judgement

- [ ] **T148** **(P)** The machine, read when it is asked about, and a judgement that refuses only a
      certain lack. `mixengine-platform` gains a `host`-only `machine` module answering glibc
      (`gnu_get_libc_version`), macOS (`kern.osproductversion`) and the Visual C++ 2015–2022 runtimes
      (`VisualStudio\14.0\VC\Runtimes\{x64,x86,arm64}`), each as present, absent or could-not-tell.
      `mixengine-core` gains the pure judgement: a year is a floor on `14.x`, the artifact's
      architecture picks the key, and anything unknown — a year with no row, an unparseable version,
      2010 and 2013 until a machine that has them is read — is never a lack. `Requires` models `cpu`
      and judges it not at all, and its doc comment stops saying nothing reads it. Design D1, D2.

## The answer

- [ ] **T149** What a client is told, before it has to ask twice. Each unmet requirement carries one
      remedy — Install for the 2015–2022 runtime, Choose the newest version of the kind that this
      machine meets for glibc and macOS, None when no version does. `RuntimeRelease` and
      `PackageRelease` gain an optional `needs` under ADR 0019, and `mix … available` grows a `NEEDS`
      column only when a row has one. `runtime.requirements` and `package.requirements` answer the
      same list for one target. The install params flatten the target and add
      `install_prerequisites` and `ignore_requirements`, and an install that would need either is
      refused with `DependencyMissing` **before its job exists**, so nothing is downloaded. Design
      D3, D4.

## The redistributable

- [ ] **T150** **(P)** Installing it, and the decision that allows it. Fetched from
      `aka.ms/vs/17/release/vc_redist.{x64,arm64}.exe` and nowhere else; believed only after
      `WinVerifyTrust`, a leaf subject of `Microsoft Corporation`, and a version resource naming the
      redistributable; held with a `FILE_SHARE_READ`-only handle until it has started; opened with
      the `open` verb and `/install /quiet /norestart`, so the installer raises its own approval and
      `mixengine-elevate` is not involved. `0`, `1638` and `3010` are success, and the machine is
      read and judged again whatever the code said. Not cancellable while it runs, and the job says
      so. **ADR 0037** records the exception this makes to *`mixengine-elevate` is the only elevated
      component*. Step zero, before any of it: the installer's real behaviour, measured on a Windows
      machine. Design D6.

## Consent

- [ ] **T151** Nobody sees an approval dialog they did not agree to. MixLab shows one dialog naming
      what will be installed, its publisher and its size, and a second button for a Choose remedy.
      `mix runtime install` and `mix package install` ask `[y/N]`, refuse on end of file, take
      `--yes` and `--ignore-requirements`, and `--json` requires `--yes` — T40b's rule, one feature
      along. Design D5.

- [ ] **T152** Blueprints. `Wanted` carries the snapshot, so a dry run and an apply judge the same
      machine; an Install remedy is one prerequisite step ahead of every install it satisfies, and a
      Choose or None remedy blocks its step with the suggestion in the reason. The apply asks once
      for the whole plan. Design D7.

## Milestone

**M18** on a Windows machine with no Visual C++ runtime, choosing PHP 8.3 in the window and agreeing
once produces one approval dialog naming Microsoft Corporation, and ends with `php -v` answering.

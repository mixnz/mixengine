# 0040. A development build's home follows its checkout, unless root cannot read it there

**Status**: Accepted
**Date**: 2026-09-19

## Context

[ADR 0024](0024-a-build-that-is-not-a-release-keeps-its-own-home.md) gave a development build its
own default home, `MixEngine-dev`, beside the released one. Two things went further and kept a
checkout's daemon inside the checkout, so that the window's daemon and a terminal's `cargo run` are
one daemon: `.cargo/config.toml` set `MIXENGINE_HOME = <repo>/.mixengine-home` for everything cargo
runs, and `apps/desktop/scripts/stage-daemon.mjs` defaulted to the same path.

Both set an **override**. On 2026-09-19 the checkout was on an external SSD, so the home and
its `run/` were there too, whatever the storage picker had chosen. Every Allow on the administrator
prompt then ended in *the elevation helper left no report beside …*. It was
[phase 17](../roadmap/phase-17-a-disk-somebody-chose.md)'s incident, reached another way: TCC gates
a removable volume, and `mixengine-elevate` arrives through `osascript` and `authtrampoline` with no
responsible process to inherit a grant from, so it cannot read its own request. Phase 17 kept `run/`
fixed so that `[paths]` could safely move everything else. It said nothing about **who picks the
home**, and for a development build that was the repository.

## Decision

**The checkout suggests a home and the binaries decide whether to take it.**

- `.cargo/config.toml` sets `MIXENGINE_DEV_HOME` to the checkout's `.mixengine-home` in place of
  `MIXENGINE_HOME`. `stage-daemon.mjs` passes the same suggestion and picks no home of its own.
- `mixengine_platform::home::development_home` weighs it, in one function that `mix`, `mixengined`
  and the window all call. Resolution is: `--home` / `MIXENGINE_HOME`, then the suggestion, then
  `HomeDirs::default_home`.
- The suggestion is **passed over**, with a `warn` naming it, when `HomeDirs::elevated_can_read`
  says an elevated process could not read that directory. On macOS that means anything under
  `/Volumes/` once spelled the way the kernel reports it. On Linux and Windows it is always
  readable: root and an elevated token read an external disk there, and the mounts that fail the
  same way (FUSE without `allow_other`, NFS with `root_squash`) are not guessed at.
- A release build ignores the variable.

## Consequences

A checkout on an internal disk behaves exactly as before. On macOS, a checkout on an external disk
gets `~/Library/Application Support/MixEngine-dev`, which ADR 0024 already reserves for development
builds, and the storage picker can still put the four directories that grow on the external disk. An
installed release keeps `MixEngine` and is never touched.

**Nothing is moved.** A `.mixengine-home` that already exists on an external disk stays where it is,
for ADR 0024's reason: moving somebody's database on a guess about which home they meant is worse
than an empty new one. The warning names the home that was passed over.

`default_home` is unchanged, and so are ADR 0024's tests. They run under cargo, where the variable
is always set, which is one reason the rule is a separate function.

## Alternatives considered

**Decide in `stage-daemon.mjs`.** `.cargo/config.toml` cannot hold a condition, so a terminal's
`cargo run` would keep the checkout's home while the window moved, and there would be two daemons
for one checkout. That is the disagreement the entry existed to prevent.

**Put the rule inside `default_home`.** This makes an answer about the platform depend on
cargo's environment, and it breaks the tests that pin ADR 0024's table.

**`~/.mixengine-home`.** A third convention beside the two ADR 0024 already names, for no gain:
`MixEngine-dev` is only ever a development build's.

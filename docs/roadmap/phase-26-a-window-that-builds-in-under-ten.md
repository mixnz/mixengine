# Phase 26 — A window that builds in under ten

*Goal: the longest leg of `build` finishes in ten minutes, without a cache and without changing
what a tag builds.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t173-a-window-that-builds-in-under-ten-design.md](../specs/2026-09-20-t173-a-window-that-builds-in-under-ten-design.md).

---

- [ ] **T173a** `.github/actions/release-profile` sets `CARGO_PROFILE_RELEASE_OPT_LEVEL=1` on any
      ref that is not a tag, and says so in the step summary.
- [ ] **T173b** The Windows legs of `window` and `binaries` exclude the workspace and `CARGO_HOME`
      from Defender, report what they did, and never fail on a refusal.
- [ ] **T173c** A branch run produces cargo's `--timings` report for the window as an artifact;
      `rust-lld` is adopted only if that report names the link and it takes a minute off.

**Milestone M26**: in a warm branch run, `window (windows-latest)` finishes in 10 minutes or less,
and `build` produces the same artifacts, with the same probes green, as run 35481399561.

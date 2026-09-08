# Phase 11 — The desktop app comes home

*Goal: MixDB's application builds, tests and packages from this repository, and a user notices
nothing.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-08-the-desktop-client-in-this-repository-design.md](../../docs/superpowers/specs/2026-09-08-the-desktop-client-in-this-repository-design.md),
on [ADR 0027](../decisions/0027-the-desktop-client-lives-in-this-repository.md).

---

**This phase moves code and changes no behaviour.** Every task here is a relocation, a replaced
copy, or a CI job; the window a person opens at the end of it is MixDB 0.0.33 under another roof.
The phase is deliberately short so that the import commit — a hundred thousand lines — carries
nothing that needs reviewing as code.

- [ ] **T100** ADR 0027 supersedes ADR 0011, and the documentation says so everywhere it said the
      opposite. `CLAUDE.md`'s architecture paragraph and workspace layout, `README.md`,
      [build-and-release.md](../operations/build-and-release.md)'s *"Rust only"*,
      [client-surface.md](../features/client-surface.md)'s opening,
      [extensions.md](../features/extensions.md)'s MixDB section, `packaging/README.md`, and
      `.claude/README.md`'s table gain a `desktop/` row. The "Non-negotiable rules" gain the two
      rules a desktop crate needs — it reaches the daemon only through the API and the published
      contract, and its toolbox modules never reach the daemon at all — and lose *"no frontend
      toolchain"*. The root `rust-toolchain.toml` and `rust-version` move to 1.98.0 in a commit of
      their own, so a lint the newer compiler adds is fixed here and not inside the import.

- [ ] **T101** MixDB arrives under `apps/desktop/` with its history, as a `git subtree add`. The
      Rust half is a Cargo workspace of its own, excluded from the root one (design, D1 and D5 of
      the ADR); its own pin file is deleted. `AGENT.md` becomes `apps/desktop/CLAUDE.md`, `.agent/`
      becomes `.claude/desktop/`, the 26 specs join `docs/superpowers/specs/`, and the MixDB
      changelog is frozen as `apps/desktop/CHANGELOG.md`. `apps/desktop/src-tauri/tests/layering.rs`
      fails on any `path` dependency other than `mixengine-proto` and `mixengine-platform`, with
      `mixengine-testkit` allowed under `[dev-dependencies]` alone. **The version stays MixDB's
      through this phase** — the design's D6 says why the workspace-version check waits for T104.
      MixDB's release scripts are deleted rather than moved. After this commit `mixnz/mixdb`
      receives one more: a README pointing here.

- [ ] **T102** The two things MixDB kept in step by hand become imports. The vendored
      `api/types/` goes and the `@mixengine/api` alias resolves to `bindings/` (D4); the pipe-name
      fingerprint, the named-pipe dial and the owner check copied out of `mixengine-platform` go,
      and the desktop crate takes `ipc::Endpoint` and `ipc::Connection` from it (D5) — with
      `windows-sys` leaving its manifest. The pinning test moves with the function.
      **What this task found and did not fix**: `[daemon] ipc_path` in `config.toml` is parsed by
      `mixengine-core` and used by nothing, so MixDB was honouring a knob the daemon ignores; the
      desktop stops reading it, and the key itself is a debt for whoever next touches `Config`.
      **(P)** — the endpoint is computed differently on each OS, and the transport test binds a
      real `Listener` and dials it on all three.

- [ ] **T103** CI knows the window exists. A `desktop` job on ubuntu runs the frontend's build,
      tests and lint and the nested workspace's clippy and tests, on every request and every tag;
      `release` waits for it. The five `build` legs set up Node, build the frontend, and run
      `npm run tauri -- build --no-bundle` (`--bundles app` on macOS) on the runner itself — the
      two Linux legs' hosts move to `ubuntu-22.04` and `ubuntu-22.04-arm`, because the manylinux
      container cannot link WebKitGTK 4.1 (D12). `cargo audit` runs in the `desktop` job against
      the crate's `.cargo/audit.toml`. Nothing is staged or packaged yet; the executable is uploaded
      as its own artifact so M11 can be checked by hand on each OS.

**Milestone M11** — the desktop application builds in this repository's CI on three operating
systems, its 1547 tests and its clippy are green there, and a build downloaded from the `build`
artifacts opens against a running daemon exactly as MixDB 0.0.33 does.

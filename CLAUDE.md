# MixEngine

A local web development environment (ServBay-style): run and switch multiple PHP / Node.js /
Python / Ruby versions, bundled Nginx/Caddy + MariaDB/MySQL/PostgreSQL/Redis/Memcached, local domains
with automatic HTTPS — without Docker, without hand-written config files.

## Architecture in one paragraph

Rust core, split into three layers. **`mixengined`** (daemon) owns all state and supervises every
managed process. **`mix`** (CLI) is a thin client over a JSON-RPC API on a local IPC transport (Unix
socket / Windows named pipe), and the **desktop application** under `apps/desktop/` is a second
thin client over the same API — typed against the published contract in `bindings/`, and reaching
no further into this workspace than `mixengine-proto` and `mixengine-platform` (see
`.claude/decisions/0027-the-desktop-client-lives-in-this-repository.md`). **Nothing runs as root.** For the few
one-shot operations that need it (hosts file, OS trust store, resolver config, firewall rules), a
short-lived **`mixengine-elevate`** is spawned through the OS elevation prompt, does the work, and
exits. Cross-platform (Windows, macOS, Linux) from day one — all
OS-specific behaviour lives behind traits in `mixengine-platform`.

## Workspace layout

```
crates/
  mixengine-core/        Domain logic: projects, sites, runtimes, services, blueprints
  mixengine-proto/       Shared API types (requests, responses, events) — single source of truth
  mixengine-platform/    OS abstraction traits + per-OS impls (hosts, trust store, DNS, limits)
  mixengine-supervisor/  Process supervision, health checks, log capture
  mixengine-daemon/      `mixengined` binary: API server + orchestration
  mixengine-elevate/     One-shot elevated binary (minimal, audited, self-validating)
  mixengine-cli/         `mix` binary
  mixengine-shim/        the version-resolving shim, copied into `<root>/bin` per command name
  mixengine-testkit/     Shared test fixtures — **dev-dependency only**, never in a shipped binary
apps/
  desktop/               the desktop application (MixLab from phase 12): a Vite + React frontend,
                         and under src-tauri/ a Cargo workspace of its own, excluded from this one
```

`apps/desktop/` carries the one Node toolchain here. `cargo` at the root never sees its crate, and
`apps/desktop/CLAUDE.md` is that application's own set of rules.

## Non-negotiable rules

- **No business logic in clients.** A client only renders what the daemon returns.
- **No client-only capability.** Every mutating API method is reachable from `mix`. A gap in the
  CLI is a gap in the product — `.claude/features/client-surface.md` is what any full graphical
  client must be able to ask for, and the desktop application draws every screen from it.
- **The desktop application is a client, not a second daemon.** Its `mixengine` module reaches
  the daemon only through the JSON-RPC API and the streams, typed against `bindings/`; its Rust may
  depend on `mixengine-proto` and `mixengine-platform` and on nothing else here
  (`apps/desktop/src-tauri/tests/layering.rs`).
- **The toolbox modules never touch the daemon.** `db`, `rest`, `terminal` and `tools` run in the
  application's own process against servers of the user's choosing; nothing in them dials
  `mixengined`, and nothing in the `mixengine` module imports from them (`npm run lint` in
  `apps/desktop`).
- **No direct OS calls outside `mixengine-platform`.** No `#[cfg(windows)]` in core/daemon code.
- **No persistent root process, ever.** Elevation is one-shot and per-operation.
  `mixengine-elevate` never runs arbitrary commands, validates every request itself rather than
  trusting the daemon, and is excluded from auto-update. The single standing thing MixEngine
  installs is macOS's boot-time `pfctl -e` job — one fixed command, root-owned, no arguments from
  anywhere — argued in
  [.claude/decisions/0012-a-boot-time-job-enables-the-packet-filter-on-macos.md](.claude/decisions/0012-a-boot-time-job-enables-the-packet-filter-on-macos.md).
- **Generated config is disposable.** Everything under `etc/` is regenerated from state in SQLite;
  never parse a generated file back into state.
- **Cross-platform or not merged.** A feature must compile on all three OSes; unsupported paths
  return a typed `Unsupported` error, never `todo!()`.
- **No Docker, no VM.** Managed processes are native. See `.claude/decisions/0003-no-container-isolation.md`.

## Detailed documentation

All design detail lives in [.claude/](.claude/) — start at [.claude/README.md](.claude/README.md).

- Architecture → [.claude/architecture/](.claude/architecture/)
- Feature specs → [.claude/features/](.claude/features/)
- Coding standards → [.claude/standards/](.claude/standards/)
- Build & packaging → [.claude/operations/](.claude/operations/)
- Decision records → [.claude/decisions/](.claude/decisions/)
- **Ordered build plan → [.claude/roadmap/todo.md](.claude/roadmap/todo.md)**

## Common commands

```bash
cargo check --workspace --all-targets   # fast feedback loop
cargo clippy --workspace -- -D warnings  # must be clean before commit
cargo fmt --all --check                  # CI's lint job gates on this too; clippy clean != fmt clean
cargo test --workspace                   # unit + integration
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --document-private-items --all-features  # intra-doc links, for this OS only
cargo sqlx prepare --workspace -- --all-targets --all-features  # after editing any sqlx::query!
bash packaging/bindings.sh               # after changing a type in mixengine-proto (T56)
cargo run -p mixengine-cli -- status      # drive the daemon from the CLI
cd apps/desktop && npm ci && npm run build && npm test && npm run lint     # the desktop frontend
cd apps/desktop/src-tauri && cargo clippy --locked --all-targets -- -D warnings  # its own workspace
```

## Working agreements

- Before implementing a feature, read its spec in `.claude/features/` — specs are authoritative.
- Changing a cross-cutting decision requires a new ADR in `.claude/decisions/`, not an edit to an
  accepted one.
- Keep the roadmap current: tick tasks in their phase file (`.claude/roadmap/phase-*.md`) as they
  land, add follow-ups where they belong in the order, do not append them at the end.
  [.claude/roadmap/todo.md](.claude/roadmap/todo.md) is the index over those files.
- **Never link to a file under `docs/superpowers/plans/`.** Those are local-only implementation
  plans, gitignored and absent on every other machine. Link to `docs/superpowers/specs/` instead —
  see [.claude/standards/plans-and-specs.md](.claude/standards/plans-and-specs.md).
- When splitting a batch of fixes across subagents, group the work by the invariant the findings
  share, not by the file they sit in — two agents editing around one invariant undo each other.
- Adding to or editing the **blueprint gallery** leaves a second repository stale: `mixengine-packages`
  publishes the same manifests as signed files, and its `publish-blueprints` workflow has to be
  re-run at the new ref. Its weekly `check-blueprints` does catch a gallery that drifted, but it
  reports on the other side and up to a week later — see
  [.claude/features/blueprints.md](.claude/features/blueprints.md).
- CI is asked for, not automatic: `master` builds itself, any other branch is pushed and then
  requested — see [.claude/operations/build-and-release.md](.claude/operations/build-and-release.md).

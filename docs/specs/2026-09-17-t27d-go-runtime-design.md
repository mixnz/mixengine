# T27d — Go, the sixth runtime kind (design)

Proposed roadmap task **T27d**, phase 2, following T27c: *"Go is installed, pinned, listed and run
exactly as a runtime is, and a `go` started through `bin/` runs the version the directory pinned —
never one a `go.mod` downloaded behind its back."*

## What was observed, and how

`mixengine-packages` published Go as its **P19**: seven lines, `go-1.21.13` to `go-1.27.1`, all six
cells borrowed from go.dev, `kind: "go"`, `provides: {"go": "bin/go[.exe]", "gofmt":
"bin/gofmt[.exe]"}` ([its packaging design](https://github.com/mixnz/mixengine-packages/blob/master/docs/superpowers/specs/2026-09-17-go-packaging-design.md)).
It left one sentence for this repository:

> the daemon has to render **`GOTOOLCHAIN=local`** into the environment it gives a project.

Three facts shape what that sentence costs here, each checked rather than assumed:

- **This build does not know Go.** `RuntimeKind` is closed at five, and
  `runtime_installs.kind` carries `CHECK (kind IN ('php', 'node', 'python', 'ruby', 'composer'))`
  from `0019_composer_runtime.sql`. An index entry of `kind: "go"` is a word this build skips. A
  variable cannot be rendered for a runtime that cannot be installed, so the sentence is the last
  step of a runtime kind, not a change of its own.
- **The environment is the shim's, not the daemon's.** A command in `bin/` is dispatched by
  `mixengine-shim`, which resolves the version in-process and builds what the program inherits in
  `surroundings` and `trusting` (`crates/mixengine-shim/src/main.rs`). The daemon never starts `go`.
  "The daemon renders" in the packaging design means "MixEngine renders", and here that is the shim.
- **`go.env` inside the archive says `GOTOOLCHAIN=auto`**, kept byte for byte by the packaging
  repository's *repack, do not rearrange* rule. With `auto`, a `go` meeting a `go.mod` whose `go` or
  `toolchain` line names a newer release downloads that release into the module cache and runs it
  instead. A project pinned to 1.25 would silently build with 1.27, which is the one failure a
  version manager exists to prevent.

## Goal

`mix runtime install go 1.25.14` puts a Go on the machine; `go version` in a directory pinned to it
answers `go1.25.14`; and `go build` in a module whose `go.mod` asks for 1.27 fails with Go's own
sentence naming `GOTOOLCHAIN=local` instead of downloading anything. Nothing changes for a machine
that never installs Go.

## Scope

**In:**

- `RuntimeKind::Go`, and every consequence `RuntimeKind::ALL` already carries.
- A migration widening the `runtime_installs` `CHECK`.
- `go` and `gofmt` in the shim table.
- `GOTOOLCHAIN=local` in the environment of a Go command.
- A doctor note for a daemon environment that would defeat it.
- The desktop project form's list of kinds.
- The feature document, the handbook's runtimes page and the roadmap.

**Out:**

- **Reading `go.mod`.** Its `go` line is a *minimum*, not a pin, and its `toolchain` line is a
  preference; neither is a version constraint in the sense `core::resolve` answers. A directory is
  pinned the way every other language is pinned — `mixengine.toml`, the project record, the default.
- **`GOPATH`, `GOMODCACHE`, `GOCACHE`, `GOBIN`.** Go's own defaults stay. The module cache is
  version-independent, and the build cache is keyed by toolchain, so neither needs a directory per
  version, and a MixEngine-owned location would be one more thing `mix uninstall` has to answer for.
- **Fronting `go install`'s programs.** They land in `GOBIN` or `GOPATH/bin`, outside every install
  and shared by every version — the same shape as Composer's global bindir, which T131 left out for
  that reason.
- **A gallery blueprint.** The packaging design records no blueprint demand, and none is invented.
- **Java.** Published beside Go, and a kind of its own with a design of its own.
- **`gopls`, `dlv` and every other tool** — separate release trains, installed with `go install`.

## Decisions

**D1 — Go is the sixth `RuntimeKind`.** `RuntimeKind::Go`, spelled `go` everywhere the others are
spelled, `override_env` `MIXENGINE_GO`. `ALL` becomes six in the order
`php, node, python, ruby, go, composer`: Composer stays last because it is the one that runs under
another kind, which is the reason T27c gave for its place. The proto test that pinned
`ALL[4] == Composer` asserts `ALL.last()` instead. Every consumer of `ALL` follows without a change
of its own; `bindings/` is regenerated.

**D2 — Migration `0025_go_runtime.sql` widens the `CHECK`.** The table is rebuilt exactly as 0019
rebuilt it — `-- no-transaction`, `PRAGMA foreign_keys = OFF`, copy out to `runtime_installs_new`,
copy back, drop, rename, recreate `runtime_installs_one_default_per_kind`, `PRAGMA
foreign_key_check`, commit — with `'go'` added to the list. No column changes, and nothing else
names a runtime kind in a constraint.

**D3 — The smoke test is `go version`.** `go` has no `--version` flag, and `go version` is the
subcommand that prints the release without touching a module. It runs from the install directory,
which holds no `go.mod`, so `GOTOOLCHAIN=auto` in `go.env` has nothing to act on and the check cannot
reach the network.

**D4 — Two shim rows.** `go` and `gofmt`, each `kind: Go`, `executable` equal to its name, `via:
None`. `gofmt` is a command people type and editors call by name; the `go tool` binaries under
`pkg/tool/` are not, and `go` finds them from its own `GOROOT`.

**D5 — `GOTOOLCHAIN=local`, from the shim, for Go only.** A function beside `trusting`, called from
`surroundings`, inserts `GOTOOLCHAIN=local` when `kind` is `Go`. It is its own function rather than a
row in `trusting`'s table because it is not about trust, and because its rule about an existing
value differs in one detail:

- **A non-empty `GOTOOLCHAIN` in the session is left alone.** ADR 0034's rule, applied to a second
  variable: somebody who exported `GOTOOLCHAIN=go1.27.1+auto` meant it.
- **An empty one is treated as unset** and replaced, because Go itself reads an empty variable as
  unset and would fall through to `go.env`'s `auto`.
- **A `GOTOOLCHAIN` written with `go env -w` is overridden**, and that is deliberate: Go's order is
  environment, then the user's `go env` file, then `GOROOT/go.env`, so the variable wins. `go env -w`
  is a machine-wide setting usually made before MixEngine was installed, and honouring it would make
  a pin mean nothing on exactly the machines that already had Go. The handbook says so in a
  sentence.

**D6 — `GOROOT` is not set.** `go` derives `GOROOT` from its own executable, and the packaging smoke
test proved that on a moved tree. A `GOROOT` the session already exports is left alone — it is the
person's — and D8 reports it, because a `GOROOT` naming another Go makes the pinned `go` compile
with that Go's tools.

**D7 — Go is told nothing about trust.** On Windows and macOS Go verifies through the operating
system's verifier, which reads the store MixEngine installs its authority into; on Linux it reads
the system bundle that `update-ca-certificates` or `update-ca-trust` regenerates after that install.
So Go is the second runtime after PHP whose row in the T133 table is empty, for a different reason:
PHP is told through its ini set, and Go already reads the store. Verified by hand on Windows and
Linux (see Testing) rather than asserted from documentation.

**D8 — A doctor note.** `daemon.doctor` gains a check, *the Go a project pins*. It is `Ok` when no
Go is installed or when the daemon's own environment carries neither variable, and a `Note` when it
carries a `GOTOOLCHAIN` other than `local` or any `GOROOT`, naming which — the shape
`trust_bundle`'s shadowing note already has, for the same reason: a shim inherits that variable and
leaves it alone. A `Note` has no `ProblemId`, so the protocol does not change.

**D9 — No globals directory.** `runtimes::globals::directory(Go)` is `None` (see Scope), and the
shim's `install_globally` answers Go with the arm PHP and Composer share.

**D10 — The desktop form lists it.** `RUNTIME_KINDS` in
`apps/desktop/src/modules/mixengine/screens/Projects/ProjectForm.tsx` gains `"go"` before
`"composer"`, with an empty pin in the form's initial record — the type regenerated in `bindings/`
makes a missing entry a compile error, which is what finds it.

**D11 — Words.** `docs/features/runtime-versions.md` gains Go in its kinds, its shim list and its
trust table; `docs/guide/en/runtimes.md` gains a *Go* section with D5's three rules, and
`packaging/docs.sh` restamps the translations; `docs/roadmap/phase-2-runtimes.md` gains T27d after
T27c, pointing here, and `todo.md`'s phase-2 row moves to 15 / 15. No ADR: D5 is ADR 0034's rule
applied to one more variable.

## Testing

- **`mixengine-proto`**: the one-spelling and closed-set tests over `ALL` cover the sixth kind;
  `MIXENGINE_GO` is asserted; Composer is `ALL`'s last element.
- **`mixengine-core`**: the kind-column test walks `ALL` and so proves the migration; a home at
  schema 0024 holding one install of each of the five kinds migrates and keeps every row and its
  default; `smoke_test(Go)` is `go version`; `shims::COMMANDS` holds `go` and `gofmt`.
- **`mixengine-shim`**, beside `tests/trust.rs`: `go` is handed `GOTOOLCHAIN=local` and `node` is
  not; a session `GOTOOLCHAIN=go1.27.1+auto` arrives unchanged; an empty one arrives as `local`;
  `go` is handed no trust variable.
- **`mixengine-daemon`**: the new check is `Ok` with nothing set and a `Note` naming the variable
  with `GOTOOLCHAIN=auto` in the environment.
- **`apps/desktop`**: `npm run build`, `npm test` and `npm run lint` over the widened list.
- **By hand, in a sandbox home on this machine**: `mix runtime install go` from the real index; a
  module whose `go.mod` says `go 1.27` under a directory pinned to 1.25 fails `go build` naming
  `GOTOOLCHAIN=local`, with nothing added to the module cache's `golang.org/toolchain`; and a Go
  program started through `bin/` fetches `https://<site>.test` — on Windows, and in WSL for Linux.

## What this closes, and where it is written

- `docs/roadmap/phase-2-runtimes.md`: T27d after T27c, ticked when it lands.
- `docs/features/runtime-versions.md` and `docs/guide/en/runtimes.md`, per D11.
- The packaging repository's open sentence — *the daemon renders `GOTOOLCHAIN=local`* — is answered
  by D5, in the shim.

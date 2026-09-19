# 0024. A build that is not a release keeps its own home

**Status**: Accepted
**Date**: 2026-09-06

## Context

MixEngine's home directory is chosen by the platform default, and that default knows nothing about
which binary asked for it. On Windows both of these resolve `%LOCALAPPDATA%\MixEngine`:

```
C:\Users\<user>\AppData\Local\Programs\MixEngine\mixengined.exe   # the installed release
cargo run -p mixengine-daemon                                     # a working tree
```

macOS and Linux are the same. So on any machine that both develops MixEngine and uses MixEngine —
which is the machine this product is written on, and will be the machine of every contributor — the
two share one database.

**The damage is not that one build refuses to open the other's database.** It is what happens before
that:

1. The working tree carries a migration that has not shipped — say `0018`.
2. `cargo run -p mixengine-daemon` opens the real home, finds the schema behind, and **migrates the
   user's real database to `0018`**. Silently, because migrating a database that is behind is
   exactly the right thing for it to do.
3. The developer edits `0018`, which is normal while it is unreleased. Its checksum changes.
4. Nothing opens that database again — not the installed release, not the developer's own build.
   The real projects are in a file no MixEngine will read.

Step 2 is the one to prevent. Steps 3 and 4 are only how the loss becomes permanent.

This was reached from the other end first. A home written by a pre-beta build refused to open under
v0.0.1-beta.1, because `0001_initial.sql` had been edited four times after that home was created —
the database recorded SHA-384 `2D05AD28…` for migration 1 and the file hashed to `2F21DD75…`. That
particular cause is closed: `crates/mixengine-core/tests/upgrade.rs` pins every shipped migration's
checksum against a frozen fixture, so editing one now fails a test. The shared home is not closed by
that, and it reaches the same dead end through `MigrateError::VersionMissing` the moment a
development build runs first.

`.cargo/config.toml` points cargo-launched processes at `.mixengine-home`, which closes the path a
developer walks daily and closes nothing else: cargo sets that variable for what cargo runs, so
`./target/debug/mixengined` started by hand is outside it — and starting it by hand is the quickest
way to read a daemon's startup failure. A fence that only holds while somebody remembers to use one
tool is not the fence this needs.

## Decision

**The default home is decided by where the binary came from, and the signal travels inside it.**

`mixengine_platform::RELEASE` is `option_env!("MIXENGINE_RELEASE").is_some()`, and
`packaging/stage.sh` is the only thing in this repository that sets that variable. Each of the three
per-OS `default_home()` implementations appends `-dev` to its directory name when `RELEASE` is false:

| OS | release | not a release |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\MixEngine` | `%LOCALAPPDATA%\MixEngine-dev` |
| macOS | `~/Library/Application Support/MixEngine` | `…/MixEngine-dev` |
| Linux | `$XDG_DATA_HOME/mixengine` | `…/mixengine-dev` |

Beside the released one rather than somewhere else, so a developer who wonders where their sites
went finds the answer in the folder they were already looking at.

`--version` says which kind of build printed it — ` (development build)` — and each OS's build script
refuses to ship an artifact that carries that note.

**`MIXENGINE_HOME` and `--home` stay authoritative over both.** This changes a default, not a rule.

**Nothing is moved.** A developer whose data is already in the release home keeps it there and finds
an empty `MixEngine-dev` the next time they build. Moving somebody's database on their behalf, on
the strength of a guess about which of two homes they meant, is a worse failure than the one being
fixed.

## Consequences

**A released binary behaves exactly as it did.** Every path above is unchanged for anybody who
installed MixEngine, so this decision reaches no user and can never block a release.

**The reverse mistake becomes the dangerous one.** A development build that claims to be a release is
a developer's own doing — they set the variable by hand and have answered the question themselves. A
*release artifact built without the marker* would put every user's data in `MixEngine-dev` on
upgrade: every project, every site, silently gone from where the previous version left it. That is
why the guard exists at all, and why it reads the artifact rather than trusting the line in
`stage.sh` that sets the variable.

The guard cannot be a unit test. A test is compiled by cargo and therefore never carries the marker,
so it can only assert the development answer; the question "did *this artifact* come out of the
pipeline" can only be asked of the artifact. One check per OS is enough because every artifact on a
leg is built from that leg's single `stage.sh` run.

**A developer who overrides the default and forgets is still exposed.** `MIXENGINE_HOME` pointing at
the real home is a deliberate act, and it stays possible because reproducing what a user reported is
a real workflow.

**One more thing to keep right.** `mix` and `mixengined` must agree about the default, because the
CLI autostarts a daemon and then connects to an endpoint derived from the home. Both link
`mixengine-platform` and read one constant, so a pair built together cannot disagree.

## Alternatives considered

**`cfg!(debug_assertions)`.** Needs no packaging change and covers `cargo run`, `cargo test` and
`cargo build`. Rejected because it answers "release" for a developer's `cargo build --release`, and
that is precisely the build somebody points at real work to see how it behaves. A signal that is
wrong on the one build most likely to be aimed at real data is not the signal.

**A cargo feature.** Rebuild tracking is guaranteed and it is more idiomatic than an environment
variable. Rejected because every binary crate would have to forward the feature to
`mixengine-platform`, and a forwarding missing from one crate is a silent disagreement of exactly the
kind the single constant exists to prevent. `option_env!` is tracked by cargo's fingerprint anyway —
measured in both directions, in a crate used as a dependency, which is how this one is used.

**A lineage marker inside the database**, so that a build not of that lineage refuses to migrate. The
strongest of the three, because it would also cover a developer who points a build at the real home
with `MIXENGINE_HOME`. Rejected on three counts:

- **It arrives too late to be read.** The marker would live in a table, and "may I migrate this?" has
  to be answered *before* migrating, including on a database whose schema this build does not yet
  understand. A guard that needs the schema in order to decide whether the schema may be touched is a
  second migration contract living beside the first.
- **It refuses instead of separating.** What it produces is another daemon that will not start, and
  another dead end of the kind this whole task began with. Splitting the default gives the developer
  a working MixEngine on both sides.
- **It forbids a legitimate thing.** Running a development build against real data on purpose is a
  real workflow, and `MIXENGINE_HOME` is how it is asked for. Turning the override into something a
  build may veto takes it away to close a hole the person is standing in deliberately.

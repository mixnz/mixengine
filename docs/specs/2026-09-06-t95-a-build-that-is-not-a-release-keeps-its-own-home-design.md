# T95 — a build that is not a release keeps its own home

**Status:** design, awaiting feedback
**Roadmap:** T95, phase 9

## The failure

MixEngine's home directory is chosen by the platform default, and that default knows nothing about
which binary asked for it. On Windows both of these resolve `%LOCALAPPDATA%\MixEngine`:

```
C:\Users\<user>\AppData\Local\Programs\MixEngine\mixengined.exe   # installed release
cargo run -p mixengine-daemon                                     # a working tree
```

The same is true on macOS and Linux. So on any machine that both develops MixEngine and uses
MixEngine — which is the machine this product is written on, and will be the machine of every
contributor — the two share one database.

**The damage is not that a build refuses to open the other's database.** It is what happens before
that:

1. The working tree carries a migration that has not shipped — say `0018`.
2. `cargo run -p mixengine-daemon` opens the real home, finds the schema behind, and **migrates the
   user's real database to `0018`**. Silently, because migrating a database that is behind is
   exactly the right thing for it to do.
3. The developer edits `0018`, which is normal while it is unreleased. Its checksum changes.
4. Nothing opens that database again — not the installed release, not the developer's own build.
   The real projects are in a file no MixEngine will read.

Step 2 is the one to prevent. Steps 3 and 4 are only how the loss becomes permanent.

This was reached from the other end first: a home written by a pre-beta build refused to open under
v0.0.1-beta.1, because `0001_initial.sql` had been edited four times after that home was created.
That particular cause is now closed — `crates/mixengine-core/tests/upgrade.rs` pins every shipped
migration's checksum against a frozen fixture. The shared home is not closed, and it reaches the
same dead end through `MigrateError::VersionMissing` the moment a dev build runs first.

`.cargo/config.toml` now points cargo-launched processes at `target/home`. That closes the path a
developer walks daily and closes nothing else: cargo sets the variable for what cargo runs, so
`./target/debug/mixengined` started by hand is outside it — and starting it by hand is the quickest
way to read a daemon's startup failure, which is why it was done twice while diagnosing this. The
fix has to travel with the binary.

## D0 — the default home is the place to intervene, and it is not the only candidate

The obvious competitor is a guard **inside the database**: a row naming the lineage that owns this
home, which a build not of that lineage refuses to migrate. It is stronger in one way that matters —
it also covers the case D5 leaves open, where somebody points a dev build at the real home with
`MIXENGINE_HOME` and the default never gets a say.

It is rejected as the primary fix, for three reasons.

**It arrives too late to be read.** The marker would live in a table, and the question "may I
migrate this?" has to be answered *before* migrating — including on a database whose schema this
build does not yet understand. A guard that needs the schema in order to decide whether the schema
may be touched has to be a row this project promises never to move, which is a second migration
contract living beside the first.

**It refuses instead of separating.** The failure it produces is another daemon that will not start
and another dead end of exactly the kind this conversation began with. Splitting the default gives
the developer a working MixEngine on both sides; a lineage check gives them a working one on
neither until they choose.

**It forbids a legitimate thing.** Running a development build against real data on purpose — to
reproduce what a user reported — is a real workflow, and `MIXENGINE_HOME` is how it is asked for.
Turning the override into something a build may veto takes that away to close a hole the person is
standing in deliberately.

What the two share is that neither protects a developer who overrides the default and then forgets.
D5 says why that is left alone.

## D1 — the signal is where the binary came from, not how it was optimised

A `pub const RELEASE: bool` in `mixengine-platform`, from `option_env!("MIXENGINE_RELEASE")`.
`packaging/stage.sh` sets that variable for the cargo build it runs; nothing else does.

**Rejected: `cfg!(debug_assertions)`.** It needs no packaging change and covers `cargo run`,
`cargo test` and `cargo build` — but it answers "release" for a developer's `cargo build --release`,
and that is precisely the build somebody points at real work to see how it behaves. A signal that is
wrong on the one build most likely to be aimed at real data is not the signal.

**Rejected: a cargo feature.** Rebuild tracking is guaranteed and it is more idiomatic, but every
binary crate would have to forward the feature to `mixengine-platform`, and a forwarding that is
missing from one crate is a silent disagreement of the kind D2 exists to prevent.

**Measured, not assumed:** cargo tracks `option_env!` in its fingerprint and rebuilds when the
variable changes, in both directions — a scratch crate printing the constant answered
`false`, `true`, `false` across three consecutive `cargo run`s. A stale artifact carrying the wrong
answer is the failure this whole task would otherwise introduce, so this is the load-bearing check.

## D2 — one constant, read by all three per-OS defaults

`default_home()` is implemented once per OS (`windows/home.rs`, `macos/home.rs`, `linux/home.rs`),
each spelling the directory name itself. The suffix is applied in all three from the one constant.

**Because `mix` and `mixengined` have to agree.** The CLI autostarts a daemon and then connects to
an endpoint derived from the home; two binaries with different defaults would start a daemon the
client cannot find, and the error would be about a pipe rather than about a directory. Both link
`mixengine-platform`, so a single constant makes disagreement impossible for any pair of binaries
built together.

## D3 — the dev home is a sibling, not a hiding place

| OS | release | not a release |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\MixEngine` | `%LOCALAPPDATA%\MixEngine-dev` |
| macOS | `~/Library/Application Support/MixEngine` | `~/Library/Application Support/MixEngine-dev` |
| Linux | `$XDG_DATA_HOME/mixengine` | `$XDG_DATA_HOME/mixengine-dev` |

Beside the real one and named for what it is, so that a developer who wonders where their sites went
finds the answer by looking in the folder they were already looking at.

## D4 — the reverse mistake is the dangerous one, and needs its own guard

A dev build that claims to be a release is a developer's own doing: they set the variable by hand,
and they have answered the question themselves. Nothing needs to stop that.

**A release artifact built without the marker is the one that hurts.** It would put every user's
data in `MixEngine-dev` on upgrade — every project, every site, silently gone from where the
previous version left it. `packaging/stage.sh` setting the variable is therefore not enough on its
own: something has to fail when a shipped binary does not carry it.

This is the open question for the plan. The shape that fits what already exists is the build legs'
own "open what was just made" checks — `packaging/windows/build.sh` already runs `mix --version` out
of the AppImage — extended to assert that the staged binary reports the release home. What it must
not be is a unit test, which is compiled without the marker by definition and would have to assert
the opposite of what a release does.

## D5 — nothing is moved

A developer whose data is already in the release home keeps it there, and finds an empty
`MixEngine-dev` the next time they build. That surprise is worth a line in the changelog and worth
not automating: moving somebody's database on their behalf, on the strength of a guess about which
of two homes they meant, is a worse failure than the one being fixed.

`MIXENGINE_HOME` and `--home` stay authoritative over both. A developer who wants one home for both
builds says so, and is then choosing it rather than discovering it.

## What has to be checked before this lands

- **`mixengine-shim`** is copied into `<root>/bin` per command name. How it finds its root decides
  whether it needs the constant at all, or whether it is already relative to where it sits.
- **`mixengine-elevate`** is excluded from auto-update and validates its own requests, but
  `mixengine_platform::install::helper_path()` is a platform function and may carry the same name.
- **The system suites and the two `probe.sh` scripts.** They exercise installed artifacts, which
  will carry the marker; any step that builds with cargo and then expects the release home moves.
- **`crates/mixengine-platform/tests/home.rs`** asserts the default path directly.
- **The documented table lives in three places** — the `HomeDirs` trait doc,
  `.claude/architecture/overview.md`, and the user guide — and all three would be wrong by half.

## Where this sits, and what it does not block

**It does not block beta.2, and it will never block a release.** By construction the change is
invisible to a released binary: one carries the marker, keeps `MixEngine`, and behaves exactly as
today. Everything that moves, moves for people who build from source.

**It should not be the last thing merged before a tag, either.** D4 is why: this is the first
release in which a packaging mistake can relocate every user's data, and that risk wants a release
whose other changes are boring, not one it shares with a rush.

In `.claude/roadmap/phase-9-ship.md` it belongs **immediately after T92 and before the `Milestone M9
— v0.1.0` line**: it is a finding the beta produced, and v0.1.0 is the next milestone that should
not be declared with it open. It is not appended to the end of the file, which is where a task with
no argument for its position ends up.

## Decision record

Where a user's data lives is a cross-cutting decision, so this lands with an ADR in
`.claude/decisions/`, not as an edit to an existing one.

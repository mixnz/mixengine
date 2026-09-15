# T143 — A disk somebody chose, while the choice is still free

Roadmap task [T143](../../../.claude/roadmap/phase-17-a-disk-somebody-chose.md), phase 17. 2026-09-15.

**The case this comes from**: a machine whose internal disk is small and whose working disk is an
external SSD, with `MIXENGINE_HOME` pointed at the external disk so that runtimes and databases
would land there. What that produced was an elevation prompt that asked for a password and then
failed with *the elevation helper left no report beside …*. The kernel said why:

```
Sandbox: System Policy: dev.mixengine.elevate(72604) deny(1) file-read-data
         /Volumes/SSD/…/.mixengine-home/run/elevate/6C37VURVr2CEX5uu/request.json
```

macOS gates a removable volume behind TCC, and the helper — spawned through `osascript` and
`authtrampoline` — arrives with no responsible process to inherit a grant from. It could not read
its own request, exited 65, and wrote no report. `macos::outcome` maps a positive exit to
`Completed`, so the daemon reported *the helper ran and left nothing*, which is true and says
nothing a person can act on.

So there are two facts in one incident. **The home cannot go on a removable volume on macOS** —
`run/` is the helper's whole contact surface, and it has to be somewhere an elevated process can
read. And **what was actually wanted has existed since the beginning and is
unreachable**: `[paths]` already moves the four directories that grow, `run/` deliberately not among
them. It is a commented block in a TOML file inside a directory most people never open, and a window
launched from Finder cannot see `MIXENGINE_HOME` at all.

This task makes that choice reachable, and refuses it at the one moment it stops being safe.

## What is already true

Written down so nothing below is built twice, and because two of these are the whole design:

- **`Paths::new` is the only place production builds a layout**, from `mixengine-core/src/lib.rs`:
  `config::load_or_create(&root.join(config::FILE_NAME))` then `Paths::new(root, &config.paths)`.
  Four keys move — `runtimes`, `packages`, `data`, `logs` — and every other directory is
  `under(name, None)`.
- **`run/` cannot move, and that is why this feature is safe on macOS.** `Paths::new` passes `None`
  for it with a stated reason, and `mixengine-cli/src/home.rs` restates it: the single-instance lock
  and the endpoint can never end up in two places. The elevation request, `response.json`,
  `elevate.lock` and the helper candidate all live under it. Confirmed by reading every arm of
  `mixengine-elevate/src/ops.rs`: **`HelperReplace` is the only operation that takes `home` at
  all**, and it reads `run/helper/`. Nothing this task moves is ever opened by a process running as
  root.
- **`config.toml` lives inside the home**, which is what makes a home self-describing: carry the
  disk to another machine, point at it, and it is laid out the way it was.
- **`config::write_template` never touches an existing file** — *"the file belongs to the user"* —
  and returns `Result<bool>`, whether it wrote one.
- **`toml_edit` is already a dependency of `mixengine-core`**, and `core::manifest` is the precedent
  for editing a file a person reads: *"So `write()` edits a `toml_edit` document"*. Comments
  survive.
- **The location is not only a lookup — it is in the rows.** `runtime_installs.install_path` and
  `services.data_dir` are `TEXT` columns holding absolute paths. This is the constraint the whole
  design turns on.
- **The shim is unaffected.** `mixengine-shim` builds `Paths::new(root, &PathOverrides::default())`
  twice, deliberately, and uses only `database_file()` and `etc()` — neither movable. Its own
  comment says why it does not read `config.toml`: a shim that parsed the user's configuration is a
  shim that fails on every command when there is a typo in it.
- **Uninstall already knows about relocation.** `uninstall/inventory.rs` walks `paths.directories()`
  and emits a `RelocatedDirectory` row for every entry that is not under the root; the daemon
  removes them from the armed list on the way out.
- **`mix` starts the daemon.** `client.rs` — *"dial it, start one if there is none"* — through
  `autostart.rs`, with `--no-autostart` to decline. MixLab does the same thing by hand:
  `health.rs::start_daemon` spawns `mixengined --detach` and reads the endpoint off stdout.
- **`mixengine-cli` does not depend on `mixengine-core`.** No sqlx, no config parsing — `home.rs`
  states the trade: `mix` has to start in milliseconds. So `mix` cannot answer any question in this
  design, and neither can the window: `apps/desktop/src-tauri` may reach `mixengine-proto` and
  `mixengine-platform` and nothing else here. **Only `mixengined` can read the database.**
- **A first run installs nothing.** Measured on a home a daemon had been started against repeatedly
  over a week: `runtimes/`, `packages/` and `data/` are `0B`. What a first start creates is `bin/`
  (shims), `etc/`, `blueprints/`, `certs/`, `mixengine.db` — all of them in the immovable set.
  `logs/` is the one movable directory a first start writes into, and only `daemon.log`.

## D1 — The window is "nothing installed yet", not "no config file yet"

The first draft of this design said the flags seed `[paths]` only when `write_template` reports it
created the file. That rule is wrong, and the hole is `mix status`: it starts a daemon, a daemon
writes `config.toml`, and the choice would be gone before anybody had been offered it.

The real constraint is not the file. It is that `install_path` and `data_dir` are **stored
strings**: until a runtime, a package or a service exists, no row names a path and relocation is a
config edit; after that, relocation is a config edit plus a file move plus a rewrite of those rows,
and doing only the first silently breaks every install.

So the window is a question for the database:

```rust
/// Whether `[paths]` may still be changed without moving anything — roadmap task T143.
///
/// Three counts and no walk of the disk: a row is what bakes a path in, so a row is what closes
/// this. `logs/` is not consulted — nothing records where a log line went.
pub async fn changeable(store: &Store) -> Result<Changeable>;

pub enum Changeable {
    /// Nothing is installed. Every key may be set.
    Free,
    /// Something is, and this is what: for a sentence a person can act on.
    Taken { runtimes: u32, packages: u32, services: u32 },
}
```

This keeps `mix status` exactly as it is — a documented behaviour with its own opt-out — and it
gives the person a window that is genuinely open rather than one that closed while they were reading
the first-run screen.

**It also makes the refusal explicable.** *"`config.toml` already exists"* is a sentence nobody can
act on. *"3 runtimes and 1 service are installed under `/Users/…/runtimes`"* names what has to move
and why nothing has yet.

## D2 — The flags, on `mixengined`, and what they are allowed to do

```
mixengined --runtimes <DIR> --packages <DIR> --data <DIR> --logs <DIR>
```

Each is optional and independent. What they do is **write into `config.toml`**, not override for the
run — and that is a departure from every other flag on this binary, so it is stated rather than
implied. `--log-level`, `--index-url` and the rest configure one process; these configure a home.

A per-run override was considered and rejected outright. The location is in the rows (D1), so a flag
that only applied to one process would let a daemon started from a launchd plist and one started
from a terminal disagree about where the same home's runtimes are, while the database agrees with
neither. `mix runtime list` would print paths that are not there, services would fail to start, and
nothing would say why. A setting that lives in the home cannot produce that.

Three outcomes, and the third is the one that needs a rule:

| | |
| --- | --- |
| Differs from what is stored, window **Free** | Written, logged at `INFO`, the start continues |
| Equals what is stored | No write, no complaint, the start continues |
| Differs, window **Taken** | **The start fails**, naming what is installed |

The second row is what lets a launchd plist or a shell alias carry the flag forever without it
becoming a thing that fires once and then breaks.

The third row **fails the start rather than ignoring the flag**, on this binary's own precedent:
`--log-format` already *"fails the start rather than being ignored — silently text-formatted output
is a log nobody is reading"*. A daemon that quietly ran with data somewhere other than where it was
just told to put it is the same defect with more at stake. The error names the three counts from D1,
names `config.toml`, and says that moving an installed home is not something this version does (D7).

Relative values are resolved against the root, exactly as `[paths]` resolves them, and every value
goes through the same `config::relocation` validation that already refuses `""`, `"."`, `".."` and
`"bulk/.."`. There is no second grammar.

## D3 — Writing into a file that belongs to the user

`core::config::set_paths(path, &requested) -> Result<Written>` — a `toml_edit::DocumentMut`, the
`[paths]` table created if it is absent, one key set per requested value, and an atomic replace
(temp file in the same directory → fsync → rename). `core::manifest::write` is the model, down to
the reason: the file has 60 lines of comments explaining the very keys being written, and a
serialiser that round-tripped the parsed `Config` would throw all of them away.

The commented examples in the template (`#runtimes = "bulk/runtimes"`) are **left exactly where they
are**. Removing them would mean matching on comment text, which is a parser for prose; leaving a
real `runtimes = …` above a commented example reads as what it is.

`write_template` is untouched. This function is the only thing in the workspace that edits a
`config.toml` a person may have edited, and it sets four keys and reads none.

## D4 — `mixengined --storage`, because nothing else can answer

The window's picker is drawn **before there is a daemon to ask**, and neither `mix` nor
`apps/desktop/src-tauri` can open the database (see *What is already true*). So the answer comes
from the one binary that can, as a read-only one-shot that prints and exits:

```console
$ mixengined --storage
{"root":"/Users/x/Library/Application Support/MixEngine",
 "paths":{"runtimes":{"path":"…/runtimes","relocated":false}, …},
 "changeable":{"free":true}}
```

A flag and not a subcommand: `mixengined` has no subcommand tree today, and growing one for a single
read would change how every existing flag is typed. It conflicts with `--detach` in clap, writes
nothing — **it does not create the home or the config file** — and answers about a home that does
not exist yet with `changeable: free` and the default layout, which is the true answer for a machine
before its first start.

`mix storage` forwards to it and prints the same facts as a table, the way `mix` already runs
`mixengined` in `autostart.rs`. That is what keeps this reachable from the command line without
linking sqlx into the binary that has to start in milliseconds.

## D5 — there is no `mix init`

An earlier draft of this design had one: `mix init [--data <DIR>] …`, creating the home with a
chosen layout, printing it, and starting no daemon. **It is not built, and this records why rather
than leaving a gap somebody reads as an oversight.**

The draft said it would forward to `mixengined` with the D2 flags *plus* `--storage`. That is not a
command line: D4's `--storage` creates nothing, by design and by its clap conflicts, and the four
flags only take effect during a start. Asking for both is asking a process to create a home and to
create nothing. So building it meant choosing between two shapes, and both cost more than the
command is worth:

- **`mix init` starts a daemon** — `mixengined --detach <flags>`, then report. Correct, cheap, and
  it makes `init` an alias for `status` with flags: two commands, one behaviour, and a command named
  *init* that leaves a daemon running.
- **`mixengined --init`**, a third mode that does the startup work and exits. Clean to describe, and
  it forces a decision about the single-instance lock: `Store::open` runs migrations, and that lock
  exists precisely so two processes cannot both migrate. Spending a concurrency decision on a
  convenience is the wrong trade.

**And nothing needs it.** The window (D6) calls `--storage` and then starts a daemon with the flags;
a person at a terminal has `mixengined --data <DIR> --detach`; a scripted install has the same. What
`mix init` would have added is a better name for a capability that already has a path — and the name
promises the one thing D1 refuses, that there is a setup step which must be caught before the
product is usable. D1's whole point is that a first start decides nothing, so a command implying
otherwise would need every document to add *"`mix init` is optional"*, a sentence that exists only
because the command does.

**A command is public surface**: shipping one is a promise to scripts, and not shipping it costs
nothing. If somebody asks for it, that request will say which of the two shapes above they meant —
which is exactly what cannot be decided now.

What is left in its place is one sentence, printed by `mix storage` on a home where the choice is
still open: *"nothing is installed yet, so these may still be moved: start the daemon with
--runtimes, --packages, --data or --logs"*.

## D6 — The screens

MixLab's MixEngine tab already gates on four states — `running`, `notAnswering`, `notRunning`,
`notInstalled`. The picker belongs on the last two, and only while D1 says `Free`:

- A row naming each of the four directories and where it would go, with one **Choose…** per row
  (Tauri's directory dialog), plus a single *put all four on one disk* shortcut that fills the four
  rows from one folder. Storage is per-key on the wire because `[paths]` is; one folder is the
  ergonomic case, not a fifth setting.
- **Start** passes only the keys the person changed, as D2 flags, to the existing
  `health.rs::start_daemon`. That function gains arguments and nothing else.
- When D1 says `Taken`, the same rows render read-only with the counts in a sentence, and a line
  saying a move is not something this version does.

Strings go into the module's `i18n/en.ts` and `i18n/vi.ts`. The window reads `mixengined --storage`
once when it draws the gate — a process per gate render, which is why `health.rs::installed` reads
the filesystem instead, and is affordable for a screen a person is looking at rather than a poll.

## D7 — What this is not

**It is not a way to move the home.** The home stays where each OS puts it, and `--home` /
`MIXENGINE_HOME` keep meaning exactly what they mean now. Moving the home moves `run/`, and `run/`
on a removable volume is the incident at the top of this document. A pointer file outside the home —
`~/.mixengine_config`, or a `home.toml` at the platform default — was considered for this and
rejected: it is a per-machine fact about a home that is otherwise self-describing, and on macOS its
main use would be to re-create a failure this design exists to avoid.

**It is not a new default location.** `~/.mixengine` was considered. It is one path to remember on
three systems, and it costs: Windows has a stated reason to be under `%LOCALAPPDATA%` rather than
the profile root — a roaming profile would copy gigabytes of runtimes at every logon — macOS hides
dotfolders from Finder, ADR 0024's `-dev` suffix rides on the platform default, and every existing
install would need a migration. It buys nothing this task needs: the default is already on the
internal disk, which is the half that matters.

**It is not a move.** Nothing here relocates a file or rewrites a row. `Taken` is a refusal, not a
fallback. A real *move storage* — stop services, move the trees, rewrite `install_path` and
`data_dir`, restart — is a job with its own failure modes and belongs in its own task.

**It is not Full Disk Access.** No grant is asked for and none is needed: the four movable
directories are read by the daemon and by managed processes, both of which are ordinary user
processes whose TCC prompts a person can answer. The elevated helper never touches them.

**It adds no RPC.** There is no `config.*` method, and `daemon.status` is unchanged. Everything here
happens before a daemon is listening, which is precisely why it is a flag and a one-shot. A running
daemon's layout is already visible — `disk.usage` reports `location` per category.

## Verification

In `mixengine-core`, against a temporary home:

- `set_paths` — a `[paths]` table created when absent; one key set with the other three untouched;
  every comment in the template still present after a write; a key overwritten rather than
  duplicated; a hand-added comment above `[paths]` still above it.
- `set_paths` refuses what `relocation` refuses — `""`, `"."`, `".."`, `"bulk/.."` — with the same
  error, proved by asserting on the shared validator rather than by restating its list.
- `changeable` — `Free` on an empty database; `Taken` with the three counts after a runtime row, a
  package row and a service row; `logs` never consulted.

In `mixengine-daemon`, starting a real daemon against a temporary home:

- The three rows of D2's table: written and reflected in `Paths`; equal value a silent no-op; a
  differing value against a database with one runtime row fails the start, and the message names the
  count and `config.toml`.
- A relative value lands under the root; an absolute one does not.
- `--storage` on a home that does not exist prints the default layout and `free`, and **the
  directory is still not there afterwards**.
- `--storage` conflicts with `--detach` at the clap level.

Across crates, because this is where a rule gets restated and drifts:

- A home with all four keys relocated: `paths.directories()` still answers twelve entries;
  `uninstall/inventory.rs` emits four `RelocatedDirectory` rows; a shim resolves and runs against
  the same home unchanged (it reads neither key).

By hand, on macOS in the shape at the top of this document — home at the platform default, the four
directories on an external volume — one runtime installed, one service started, and **one elevation
prompt granted**, which is the assertion that the helper never reaches the chosen disk.

## Risks

- **An absent volume stops the daemon.** `/Volumes` is `root:wheel drwxr-xr-x`, so `create_dir_all`
  under an unmounted mount point fails with a permission error rather than quietly creating a
  directory that shadows the real one. It fails safely and says something; it still fails, and a
  person who unplugs a disk has a daemon that will not start. The `--storage` output is what a
  diagnosis reads.
- **`logs` carries `daemon.log` with it.** Relocating after a first start leaves the old file where
  it was. Harmless, and the screen says so rather than leaving somebody to find two logs.
- **The window can be closed by accident.** Installing one runtime to try the product closes it.
  That is the honest consequence of the rows and the reason D7 keeps *move* as a real task rather
  than pretending this is reversible.

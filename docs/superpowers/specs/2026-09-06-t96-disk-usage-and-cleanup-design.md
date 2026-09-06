# T96 — Disk usage by category, and a cleanup that can only reach what is safe to lose (design)

Roadmap task **T96**, phase 10: *"Disk usage broken down by category, and a cleanup that can only
reach what is safe to lose."* It closes half of the one acceptance criterion
[client-surface.md](../../../.claude/features/client-surface.md) currently fails — the Dashboard's
*"disk usage broken down by category (runtimes, data, logs, certs) with a cleanup action"* has no
method behind it. The other half is **T97**.

Three things this task changes about the sentence it was written from, all argued below: there are
**five categories and not four** (D1), the five **do not sum to the home** and the report says so
rather than letting a chart lie (D2), and `daemon.cleanup` **refuses to run beside another job**
because `cache/` is where a download in flight and a staged update payload both live (D6).

## Goal

Somebody who wants to know where their disk went types `mix disk` and gets five rows, each with a
size and, beside it, *what would take it back* — and learns from the same table that the only two
rows worth acting on are `logs/` and `cache/`. They then type `mix cleanup`, are shown exactly what
is about to go, say yes, and get back the megabytes with nothing else touched: their databases are
where they were, their runtimes are still installed, their crash reports are still readable and
their sites still serve HTTPS.

A graphical client draws the same table and the same button from the same two methods, deriving no
policy of its own about which category can be reclaimed by what.

## Scope

**In:**

- `mixengine-proto`: `disk_api.rs` — `DiskUsageQuery`, `DiskUsage`, `CategoryUsage`, `DiskCategory`,
  `Reclaim`, `CleanupQuery`, `CleanupReport`, `Cleaned`, `Cleanup`; two method names on
  `rpc::method`.
- `mixengine-daemon`: `disk/` — `measure.rs` (the walk) and `mod.rs` (both halves), plus two RPC
  methods.
- `mixengine-cli`: `mix disk` and `mix cleanup`, their confirmation and their rendering.
- Docs: `docs/guide/en/cli.md` regenerated, the Dashboard line and the acceptance-criteria paragraph
  in `client-surface.md`, the phase 10 tick, and a `troubleshooting.md` paragraph in both locales.
- TypeScript bindings: `bash packaging/bindings.sh` after the proto change.
- Tests: unit tests beside each new function, and `crates/mixengine-cli/tests/disk.rs`.

**Out:**

- **A sixth category for `packages/`.** The roadmap says five and names them; `packages/` is the
  largest thing in the remainder and is said so on the wire — see D2 and *What this leaves*.
- **Reclaiming anything by a route this method does not own.** No runtime is uninstalled here, no
  certificate is deleted here, no database is touched here. `runtime.uninstall`'s refusal to remove a
  runtime under a running pool (**T32**) is a refusal `daemon.cleanup` must not be a way around, and
  the query type below has no field that could ask.
- **Per-service or per-runtime breakdown.** *Which* PHP version is costing 400 MB is
  `runtime.list_installed`'s question, and it already answers it.
- **A quota, a watermark or an automatic sweep.** Nothing here runs on a timer. A cleanup happens
  because somebody asked for one.

## The types

```rust
/// What `daemon.disk_usage` takes.
pub struct DiskUsageQuery {
    /// Walk the disk now rather than answering from the last reading.
    ///
    /// **Defaults to `false`**, which is the cheap answer a dashboard wants. See D5.
    #[serde(default)]
    pub refresh: bool,
}

pub struct DiskUsage {
    /// `MIXENGINE_HOME`, for a person to read. A category `[paths]` has moved is not under it.
    pub root: String,

    /// When the walk this answer comes from happened.
    pub measured_at: Timestamp,

    /// Exactly five, in `DiskCategory::ALL`'s order, whatever each answered.
    pub categories: Vec<CategoryUsage>,

    /// Everything else this home holds: `bin/`, `etc/`, `packages/`, `extensions/`, `blueprints/`,
    /// `run/`, the database with its write-ahead log, and `config.toml`. Dominated by `packages/`
    /// — see D2.
    pub other_bytes: u64,
}

pub struct CategoryUsage {
    pub id: DiskCategory,
    /// Where it actually is, which `[paths]` may have moved out of the root.
    pub location: String,
    pub bytes: u64,
    pub files: u64,
    pub reclaim: Reclaim,
    /// Set when part of it could not be read, so `bytes` is a floor and not a total.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unreadable: Option<String>,
}

#[serde(rename_all = "snake_case")]
pub enum DiskCategory { Runtimes, Data, Logs, Certs, Cache }

#[serde(tag = "reclaim", rename_all = "snake_case")]
pub enum Reclaim {
    /// Nothing here removes it, and nothing should. `data/`.
    Never { because: String },

    /// Another method removes it, named — with the refusal that method carries.
    /// `runtimes/` → `runtime.uninstall`.
    ByMethod { method: String, because: String },

    /// It can go, and what it costs is not disk. `certs/`.
    AtACost { because: String },

    /// `daemon.cleanup` removes it, and this much of it is what it would take now.
    /// `logs/`, `cache/`.
    ByCleanup { bytes: u64, files: u64 },
}

/// What `daemon.cleanup` takes.
///
/// **Two negative flags and no list**, on `UninstallQuery::keep_home`'s idiom: `{}` is the complete
/// cleanup, and there is no field in which `data` or `runtimes` could be spelled at all. See D4.
pub struct CleanupQuery {
    #[serde(default)] pub keep_logs: bool,
    #[serde(default)] pub keep_cache: bool,
}

pub struct CleanupReport {
    /// One entry per reclaimable category, in a fixed order, whatever each answered.
    pub items: Vec<Cleaned>,
}

pub struct Cleaned {
    pub id: DiskCategory,        // only `Logs` and `Cache` ever appear
    pub location: String,
    pub outcome: Cleanup,
}

#[serde(tag = "cleanup", rename_all = "snake_case")]
pub enum Cleanup {
    /// There was nothing of that kind to take.
    Empty {},
    /// Gone — counted as each file went.
    Reclaimed { files: u64, bytes: u64 },
    /// Some of it went and some of it would not, and why.
    Partial { files: u64, bytes: u64, left_behind: u64, because: String },
    /// Deliberately left, because the caller asked.
    Kept { because: String },
    /// None of it went, and why.
    Failed { because: String },
}
```

`CleanupReport::reclaimed_bytes()` sums the two rows; `CleanupReport::left_behind()` is true for a
`Partial` or a `Failed`, and is `mix cleanup`'s exit code — `UninstallReport::left_behind`'s rule.

## Decisions

### D1 — Five categories, because a chart of four has nothing to do underneath it

`client-surface.md` names runtimes, data, logs and certs. Of those, one is somebody's databases, one
is removed only by uninstalling a runtime, and one is measured in kilobytes. A disk screen built
from the four would put a cleanup button under a chart where nothing is safely reclaimable, which is
worse than no button: it either does nothing or it does something it should not.

`cache/` is the fifth and it is the one anybody actually wants back — a verified package index, an
extension registry, an update feed, resumable partial downloads, staged update payloads and up to
three diagnostics archives. It is disposable by construction: every byte in it can be asked for
again.

### D2 — The five do not sum to the home, and the report says so rather than letting a chart lie

`bin/`, `etc/`, `packages/`, `extensions/`, `blueprints/`, `run/`, `mixengine.db` with its `-wal`
and `-shm` companions, and `config.toml` are none of the five. A report that answered five numbers
and stopped would be one from which a client draws a pie chart that is missing its largest slice on
any machine with nginx and MariaDB installed.

So `other_bytes` is on the wire, measured from the same closed list of directories rather than from a
walk of whatever happens to be sitting in the home — `daemon.bundle`'s rule (**T93**) in the other
direction. A client sums six numbers, which is arithmetic and not policy.

**`packages/` is inside that remainder and that is a compromise, not a conclusion.** It is
reclaimable through `package.uninstall`, which is a `Reclaim::ByMethod` answer this design can
already express; it is in the remainder only because the roadmap sentence says *five*. Making it the
sixth is a roadmap edit, not this task's — recorded under *What this leaves*.

### D3 — Four kinds of reclaim, and the API states them rather than letting a client derive them

The roadmap sentence is that the categories *"are not the same kind of thing, and the API has to say
so rather than let a client find out"*. There are four different answers among five categories:

| category | answer | why |
|---|---|---|
| `data/` | `Never` | they are somebody's MySQL and Postgres instances |
| `runtimes/` | `ByMethod { "runtime.uninstall" }` | and that method refuses a runtime under a running pool — **T32** |
| `certs/` | `AtACost` | a leaf that goes costs its site HTTPS until `cert.issue` runs again |
| `logs/`, `cache/` | `ByCleanup { bytes, files }` | this method, and this much of it |

`AtACost` is its own variant rather than a `ByMethod` naming `daemon.uninstall`, because no method in
this API deletes a certificate file: `cert.ca_uninstall`'s own documentation says *"Trust and never a
file… Deleting is uninstall's, T87"*. Answering `ByMethod { "daemon.uninstall" }` would tell a client
that the way to get 40 KB back is to remove the product.

`ByCleanup` carries its own `bytes` and `files`, which are **not** the category's: `logs/` is
`daemon.log`, the per-service `current.log` files, `logs/crashes/` and the rotated copies, and only
the last of those goes. That number is the plan half of this task — the moment in which somebody is
shown what is about to be lost.

### D4 — `data` and `runtimes` are unspellable, not refused

`CleanupQuery` could have been `{ categories: Vec<DiskCategory> }` with a validator refusing
anything but `Logs` and `Cache`. Two negative booleans are better for the same reason
`UninstallQuery` has `keep_home` rather than a list of things to remove: the refusal cannot be
forgotten, cannot be got wrong in a later edit, and does not exist as a code path that a fuzzer, a
new method, or a mis-typed client can reach. `{"runtimes": true}` is an `invalid_argument` from
`deny_unknown_fields`, which is the only refusal there is.

`{}` is the complete cleanup, matching `UninstallQuery`'s default and `mix cleanup`'s no-flag form.

### D5 — A read, and a cached one, because the screen that wants it re-reads on every event

`daemon.disk_usage` is a read in the strict sense `daemon.doctor` and `daemon.uninstall_plan` are:
no row written, no file written, nothing enqueued, no prompt possible.

It is also a walk of `runtimes/`, which on a home with two PHP versions and a Node is tens of
thousands of files. The Dashboard this exists for holds the event stream open and re-reads when
something changes, so an uncached reading is a disk walk per event.

So the daemon holds the last `DiskUsage` and answers from it while it is younger than **60 seconds**,
unless `refresh` says otherwise; `measured_at` is on the answer either way, so a client is never
guessing how old the figure is. The measurement is taken under a `tokio::sync::Mutex`, which makes it
single-flight: a second caller arriving during a walk waits for that walk rather than starting one of
its own, and then finds a fresh reading.

`mix disk` sends `refresh: true`; a person who typed a command is asking about now.

### D6 — `daemon.cleanup` refuses to run beside another job, because `cache/` is where work in flight lives

`cache/downloads/<sha256>.part` is a resumable download that `runtime.install` *is currently writing
to* — `install.rs` keeps it across a failure, a cancellation and a daemon restart on purpose.
`cache/updates/<version>/` is a payload `update.apply` has verified and is about to run.

Unlinking either mid-flight is not a tidy-up; it is a broken install. On Windows the unlink fails and
the cleanup reports `Partial`, which is survivable. On Linux and macOS it *succeeds*, the download
goes on writing to an unlinked inode, and the rename at the end fails with `NotFound` — an install
that breaks for a reason nothing in its own log explains.

So `daemon.cleanup` answers `precondition_failed`, naming the job, when any other job is `Running`.
The check happens **twice**: in the RPC handler before `jobs.begin`, so the refusal is a plain error
rather than a failed job, and again as the job's first step, so a job that started in between is
caught. The residual window is between the second check and the first unlink, and an install that
begins there has not created a `.part` file yet.

This is a real restriction and it is the right one: a cleanup is never urgent, and the alternative is
a rule that is correct on one operating system.

### D7 — What may be removed is a closed list of *names*, never a walk

`daemon.bundle`'s rule (**T93**) applied to deletion. Under `logs/`, exactly two shapes go:

- `<logs>/daemon.log.<digits>`
- `<logs>/services/<any directory>/current.log.<digits>`

and nothing else, at no other depth, no directories, and only when `symlink_metadata` says the entry
is a regular file. That rule excludes, by construction rather than by remembering:

- **the live files.** `daemon.log` and each `current.log` have an open handle in this process. On
  Windows the unlink fails; on Unix it succeeds and the daemon goes on logging to nowhere.
- **`logs/crashes/`.** `crash.rs` states the rule this task must not break: *"Nothing deletes them…
  a repair that threw away evidence nobody had read yet would be the wrong kind of tidy."*
- **a service directory whose service has been deleted.** Its `current.log` is the only record of
  what that service last did, and it is not a rotated copy.

Under `cache/`, the closed list is the four things this build puts there — `index.json`,
`extensions.json`, `latest.json`, and the `downloads/`, `updates/` and `diagnostics/` directories —
and the directories themselves are emptied rather than removed, because `Paths::bootstrap` created
them and the daemon is running.

**A rotation racing an unlink is already safe, and this was checked rather than assumed.**
`RotatingFile::shift` moves `daemon.log.4` → `.5` and so on through `move_aside`, which returns
`Ok(())` on `NotFound`. A rotated copy removed underneath a rotation in progress costs nothing.

### D8 — The walk never follows a symlink, and never fails a category

`std::fs::read_dir` plus `symlink_metadata`, descending only into an entry whose metadata says
`is_dir()`. A symlink is counted as itself and never followed. Without that rule a link somebody put
in `data/` pointing at `/` is a walk of the whole disk reported as MixEngine's, and a cycle is a
hang.

Sizes are **apparent** — `metadata.len()` — and not blocks allocated. That is what Explorer's *Size*
column and a `ls -l` say, it is the only figure `std` gives on all three systems, and it is stated
once here and once in the type's documentation so nobody has to work out which it is by comparing
against `du`.

A directory that is not there is `bytes: 0` and not an error: a home that has never crashed has no
`logs/crashes/`, and a `[paths]` override onto a disk that is not mounted is a `data/` that cannot be
read. An entry that cannot be read sets `unreadable` on its category — *"the total is at least this"*
— and the call succeeds. A read that fails and a directory that is empty are different answers, which
is the distinction `daemon.bundle` already draws between an omission and an empty member.

Files vanishing mid-walk are ordinary: a rotation, an install finishing. `NotFound` on an entry
`read_dir` just listed is skipped silently and is not an `unreadable` note.

### D9 — Everything that touches the disk happens off the runtime's threads

Both the walk and the sweep are `tokio::task::spawn_blocking`, per
`.claude/standards/rust.md`: *"nothing blocks the runtime"*. A `read_dir` of a cold `runtimes/` on a
spinning disk is seconds, and the daemon is supervising processes while it happens.

### D10 — The act measures what it removed, it does not claim it

`Cleanup::Reclaimed { files, bytes }` is counted from the `symlink_metadata` taken immediately before
each successful unlink, so the figure is of files that are actually gone. A file whose removal fails
is counted into `left_behind` and its reason into `because` — the first reason, not a list, because a
directory that will not empty gives the same reason for every file in it.

`Partial` rather than `Failed` when anything at all went, so that a person who reclaimed 300 MB and
lost one file to an antivirus is told they reclaimed 300 MB.

### D11 — `mix disk` and `mix cleanup`, top-level

Not `mix daemon disk`. They are about this machine's home the way `mix doctor` and `mix uninstall`
are, and `mix uninstall` settled the placement question in T87 (D11): the noun is the home, and the
home is what `mix` is pointed at.

`mix cleanup` confirms before acting, showing the two reclaimable rows and their sizes, with `--yes`
for a script. `--keep-logs` and `--keep-cache` map to the query; `--no-wait` prints the job and
returns; `--json` prints the `CleanupReport`. It exits non-zero when anything was left behind.

`mix disk` sends `refresh: true`, prints the five rows plus *other* with sizes and what reclaims
each, and ends with what `mix cleanup` would take back.

### D12 — Neither method bumps `PROTOCOL_VERSION`

Two methods added, no member removed, no member's type or meaning changed. An older client never
calls them; an older daemon answers `method_not_found`, which is what
`.claude/decisions/0019-an-added-response-member-is-optional.md` leaves as the ordinary shape of a
mixed-version pair.

## Data flow

**`daemon.disk_usage`**

1. `Api::disk.usage(&query)` takes the mutex.
2. If `!query.refresh` and the held reading is younger than 60 s, it is returned.
3. Otherwise `spawn_blocking` walks, in order: the five category directories, then the remainder's
   six directories and two files. Each walk is `read_dir` + `symlink_metadata`, no symlink followed.
4. `Reclaim` is attached per category. `ByCleanup`'s figures come from the same walk: the log walk
   counts rotated files separately as it goes, and the cache walk counts everything it saw.
5. The reading is stored with `measured_at` and returned.

**`daemon.cleanup`**

1. The RPC handler asks `jobs.list` for anything `Running`. One → `precondition_failed` naming it.
2. `jobs.begin`. First step: the same check, now excluding this job's own id.
3. `progress(10)` — the log sweep, unless `keep_logs`. Names matched, `symlink_metadata` checked,
   unlinked, counted.
4. `progress(55)` — the cache sweep, unless `keep_cache`. The three files and the three directories'
   contents.
5. `progress(90)` — the held reading is dropped, so the next `daemon.disk_usage` measures rather than
   answering with the sizes of files that are gone.
6. The report is the job's result.

## Testing

**`mixengine-proto`** — wire shapes: a `CategoryUsage` with each `Reclaim` variant round-trips
tagged; `DiskCategory::ALL` has five distinct spellings; `CleanupQuery` from `{}` cleans everything
and `{"runtimes":true}` is refused; `CleanupReport::left_behind` is true for `Partial` and `Failed`
and false for `Empty`, `Reclaimed` and `Kept`.

**`mixengine-daemon`** — against a temporary home:

- the walk counts a nested tree and does not follow a symlink out of it *(Unix only; a Windows
  symlink needs a privilege the test runner does not have)*;
- a category directory that does not exist is `0`, not an error;
- an unreadable subdirectory sets `unreadable` and the call still succeeds *(Unix only — a
  `chmod 000` directory; Windows ACLs are a different mechanism and this asserts the daemon's
  behaviour, not the platform's)*;
- the log sweep removes `daemon.log.1` and `services/a/current.log.2` and leaves `daemon.log`,
  `services/a/current.log`, `crashes/*.json` and a stray file untouched;
- the cache sweep empties `downloads/` and `updates/` without removing the directories;
- `keep_logs` leaves the logs and reports `Kept`;
- a second reading after a cleanup is smaller — the cached one was dropped;
- two concurrent `disk_usage` calls produce one walk.

**`mixengine-cli`** — `crates/mixengine-cli/tests/disk.rs`, against the shared harness's daemon:
`mix disk --json` parses as `DiskUsage` with five categories in order; `mix cleanup --yes --json`
parses as `CleanupReport`; `mix cleanup` with a job running exits non-zero and names it; `mix disk`
without a daemon fails with the usual message.

**Docs** — `bash packaging/docs.sh --reference` regenerates `cli.md`; CI's diff is the gate.

## Risks, and where each is answered

| risk | answer |
|---|---|
| A cleanup breaks a download or a staged update | D6: refuses beside a running job, checked twice |
| A cleanup throws away crash evidence | D7: the name rule cannot reach `logs/crashes/` |
| A cleanup unlinks a log the daemon holds open | D7: only `*.log.<digits>` goes |
| A symlink turns the walk into a walk of the disk | D8: never followed |
| A dashboard turns a read into a disk walk per event | D5: cached, single-flight, `refresh` to force |
| A walk stalls the daemon | D9: `spawn_blocking` |
| A pie chart of five slices is missing its largest | D2: `other_bytes` |
| A client uses cleanup as a way around T32 | D4: `runtimes` is unspellable in the query |
| A figure disagrees with `du` | D8: apparent size, stated |

## What this leaves

- **`packages/` deserves a category of its own.** It is the largest thing in `other_bytes` on any
  home with a database installed, it is reclaimable through `package.uninstall`, and `Reclaim`
  already has the variant that would say so. Adding it is one entry in `DiskCategory::ALL`, one arm
  in the measurement and one row in the answer — and a roadmap edit, because T96's sentence says
  five.
- **Nothing is per-item.** *Which* runtime or *which* service's logs cost the most is not answered
  here; `runtime.list_installed` answers the first and nothing answers the second yet.
- **No `daemon.cleanup` event.** The event stream says nothing when megabytes go. A client that
  wants to redraw calls `daemon.disk_usage` with `refresh`, which is what it would do anyway after a
  job it started finished.

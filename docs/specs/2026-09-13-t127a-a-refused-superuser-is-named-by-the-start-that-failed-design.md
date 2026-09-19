---
status: implemented
date: 2026-09-13
task: T127a
---

# T127a — a refused superuser is named by the start that failed (design)

Roadmap task **T127a**, phase 14, following T127: *"A database that cannot start because its
superuser password is wrong says so, rather than reporting a ready check that timed out. T127's
explanation is reached from the provisioning probe, which a PostgreSQL instance never gets to: its
ready check authenticates, so the failure is a `ReadyTimeout` two minutes long and the hint sent
somebody to the service log. What the log holds is `password authentication failed`, one line, from
the server itself — so the shape of the fix is a start failure that reads what the service printed
before it decides what to call the failure."*

## What is already known, and where it was measured

Nothing here needs a new measurement. T127 left the symptom asserted rather than wished away, in
`crates/mixengine-cli/tests/postgres.rs`, against a real PostgreSQL whose data directory holds a
superuser password the keyring does not:

```rust
assert!(
    said.contains("did not start"),
    "the symptom is no longer a start that never finished: {said}"
);
```

The three facts that shape this task, all of them already recorded:

**PostgreSQL's ready check authenticates and MariaDB's does not.** The PostgreSQL recipe's check is
`ReadyCheck::Command` running `psql` with a query, carrying the superuser password out of the
keyring (`crates/mixengine-core/src/generate/recipes/postgres.rs`); MariaDB's is `mariadb-admin
ping`, which answers before authentication. So a MariaDB instance with the wrong password reaches
`running`, and the provisioning probe in `crates/mixengine-daemon/src/services/databases.rs` meets
the refusal and `explain_a_refused_superuser` says what it means. A PostgreSQL instance never leaves
`starting`, and that function is never reached.

**The refusal is in the service's own log, and is there because the recipe put it there.**
`postgresql.conf` in this repository sets `logging_collector = off` and `log_destination =
'stderr'`, with the stated reason that stderr *"is the pipe the supervisor is reading"*. Every
refused `psql` attempt — one every 250 ms, `COMMAND_RETRY` in `crates/mixengine-supervisor/src/ready.rs`
— makes the server print `FATAL:  password authentication failed for user "postgres"` into that
pipe, where `Capture` keeps the last 500 lines (`LogPolicy::default`).

**The daemon already reads evidence before it names a failure.** Twice. A ready timeout asks the OS
who holds the port before it settles on `ReadyTimeout` or `PortInUse` (T38,
`Runner::port_conflict`), and a crash loop attaches the last 200 lines to
`StateReason::CrashLoop { tail }` (`crates/mixengine-supervisor/src/restart.rs`). This task is a
third reader of the same kind, and deliberately looks like the first two.

## Goal

A PostgreSQL instance whose data directory and whose keyring have come apart fails its start with a
reason that names *that*, and with the repair T127 built — `mix service reset-credential <service>`
— rather than with `not ready within 2m` and a hint pointing at a log the user then has to read.

## Scope

**In.**

- A new `StateReason` for a server that is up and refusing the superuser password this home holds.
- The daemon reading a failed start's captured output before it decides what to call the failure,
  for services that have a database vocabulary.
- One place that owns what a refused superuser looks like, read by both the provisioning probe (T126)
  and this new path.
- The repair named on both paths a user meets it on: the `database.create` error's hint, and the
  walk `mix service start` prints.
- Bindings regenerated; `docs/architecture/process-supervision.md` brought back into line.

**Out.**

- Aborting the start early, when the refusal is first printed. See D9.
- Any change to `ready::wait`, `ReadyCheck`, or the supervisor crate at all.
- Any change to what the repair does. T127 built it and this task only points at it.
- MariaDB and MySQL behaviour, which already reach `running` and are already explained.
- A desktop affordance. Nothing in `apps/desktop/src` reads `StateReason` today.

## Decisions

### D1 — The reading happens when the failure is named, not while the start is still running

The obvious alternative is to race the log against `ready::wait` and abort the moment a refusal is
printed, turning a two-minute wait into a two-second one. It is rejected, and the reason is what an
abort would be acting on.

During `starting`, MixEngine's own ready check is not the only thing that can be refused by that
server. A developer's application, a `pgAdmin` left polling, a second MixEngine home — any of them
connecting with a stale password writes the same sentence into the same pipe. A reader that only
*renames a failure that already happened* cannot be wrong about anything except the wording; a
reader that **kills a starting cluster** on one log line can take down a start that was going to
succeed, and the user's recovery is to work out that MixEngine did it.

The roadmap says the same thing in the task's own words — *"a start failure that reads what the
service printed **before it decides what to call the failure**"* — and it is T38's shape exactly:
the port is not asked about until the start has already failed.

What this costs is stated plainly rather than hidden: the user still waits out
`ready_timeout_ms` (120 s for PostgreSQL). That number is the recipe's and a person can lower it;
the sentence they get at the end of it is what this task changes.

### D2 — Only a service with a database vocabulary is read this way

The gate is `Registry::provisioning_for(id)` — the map T77a already fills from every `Generated`
carrying a `DatabaseAdmin`. A service that has one is a database; a service that has none is not
read for refusals at all.

**Not a purity argument.** `php-fpm` captures its workers' stderr, and a Laravel application that
cannot reach its database prints `SQLSTATE[HY000] [1045] Access denied for user …` into exactly that
stream. A pool that failed its start for an unrelated reason would then be reported as a pool whose
superuser password is wrong, and the repair offered — `mix service reset-credential php-fpm@8.3` —
answers `Unsupported`, because a pool keeps no credential of its own. One misleading sentence and
one dead end, avoided by asking a question the daemon can already answer.

### D3 — The line has to name the superuser, not merely be a refusal

`explain_a_refused_superuser` matches an *error message from a statement MixEngine itself ran*: the
provisioning probe, with the superuser credential, so anything it is refused for is about that
credential. A log line has no such provenance — it is whatever the server said to whoever was
talking to it.

So the log matcher requires two things in one line: one of the refusal sentences, **and** the name
of this instance's superuser, which the recipe already declares as `DatabaseAdmin::root`
(`postgres` for PostgreSQL, `root` for the MySQL family) and which `Provisioning` grows an accessor
for. `FATAL:  password authentication failed for user "postgres"` matches. An application's
`password authentication failed for user "shop"` does not, and is left to be a ready timeout, which
is what it is.

The residue this leaves is a third party connecting *as the superuser* with a wrong password during
a start that failed for another reason. That is a user who has the superuser password in an
application's configuration and it is stale — which is a credential that has come apart, so the
sentence is not even wrong. Recorded, not guarded against.

### D4 — One vocabulary, two readers

The three refusal sentences are already a constant in
`crates/mixengine-daemon/src/services/databases.rs`, and T127 measured why one of them is prose
rather than a code:

```rust
const REFUSALS: [&str; 3] = ["ERROR 1045", "28P01", "password authentication failed"];
```

A second copy in `runner.rs` would be the thing that goes stale the next time a client changes its
wording. `databases.rs` keeps them and grows one function — the log matcher of D3 — beside the
message matcher it already has. The module that knows what a refused superuser looks like is the
module that knows it, and `runner.rs` asks.

The hint T126 wrote is extracted the same way and for the same reason: two paths now offer the
repair, and there is one sentence about it.

### D5 — A `StateReason` of its own, carrying the line as evidence

```rust
/// The server is up, and refuses the superuser password this home holds — roadmap task **T127a**.
SuperuserRefused {
    /// The line the server printed, in its own words.
    said: String,
},
```

Display is the half-sentence the type's contract asks for and nothing more —
`it refuses the superuser password this home holds` — with the evidence left to the client to lay
out, which is `StateReason::CrashLoop`'s arrangement and the reason its documentation calls `tail`
*"the one variant that carries evidence"*. It is two now, and that sentence is corrected in
`docs/architecture/process-supervision.md` rather than left to be found.

**One line and not a tail.** A crash loop explains nothing without its lines; this reason explains
itself, and the line is confirmation rather than the substance. One line is also what keeps an event
on the stream small — `Capture` already bounds a line at 8 KB — so no second bound is invented here.

**It carries no secret.** Neither client prints a password in a refusal: PostgreSQL names the role
and the `pg_hba.conf` line, the MySQL family names the account and the host. What the matcher selects
is one of those lines and nothing else.

### D6 — A port conflict still wins

The precedence at the timeout is `port conflict → refused superuser → ready timeout`, and the order
is not arbitrary. If another program holds 5432, the `psql` the ready check runs is talking to *that
program* — a refusal it printed is not this cluster's, and `PortInUse` is the fact worth reporting.
Refusal is asked only where nobody else holds the port.

### D7 — The repair is named on both paths, by whichever end has somewhere to put it

`Registry::ensure_running` — which is what `database.create` walks through, and where T127's
reported symptom arrives — already carries a hint, and it becomes reason-aware: a
`SuperuserRefused` gets T126's repair sentence, everything else keeps `mix service logs`.

`mix service start` renders a `ServiceWalk`, which has no hint field and is not being given one for
this. `render::service_walk` already lays out `CrashLoop`'s tail as indented lines; it lays out
`said` the same way and adds one line naming `mix service reset-credential <service>`. A client
naming *its own command* is what `render.rs` already does for a certificate problem, and it is not
business logic: the daemon said what happened, and `mix` said which of `mix`'s commands undoes it.

### D8 — `StoppedBy::of` never sees this word, and the answer if it did is "wakeable"

T127's hard-won lesson was that a new `StateReason` reaches `StoppedBy::of` through a `_` arm and
becomes wakeable without the compiler saying anything. That was fatal there because the word was
carried into `Stopped` while a repair held the data directory.

This word is only ever carried into `Failed`, by `Runner::give_up`, and `StoppedBy::of` is
documented as *"consulted only on the way into `ServiceState::Stopped`"*. So the `_` arm is the right
answer and not an oversight — and the assertion that says so is written down anyway, in
`mixengine-core`'s own tests, because "wakeable" is the answer this task wants if the word ever does
reach there: a database that refused its superuser is not a service somebody deliberately stopped,
and a connection asking for it should be allowed to try.

### D9 — What this deliberately does not do

**It does not shorten the wait.** D1 has the argument. The number belongs to the recipe's
`ready_timeout_ms` setting and a person can lower it.

**It does not read the probe's own output.** `ReadyCheck::Command` runs `psql`, whose stderr says
`psql: error: connection to server … FATAL:  password authentication failed` — and because that is
*our* connection being refused, it would need none of D3's guard. It is rejected because of what it
would cost: `ready::probe` returns `Result<()>` and discards output, so this means a new shape in
`mixengine-supervisor`'s public API, reaching every ready check, to serve one recipe — and it would
work for `Command` checks alone, where reading the service's log works for any of them. The roadmap
chose the log. This records the alternative rather than pretending it was not there.

**It does not touch the `Exited` or crash-loop paths.** A PostgreSQL server does not exit because a
client was refused; there is no failure there to rename, and `CrashLoop` already carries the lines.

**It does not add a `mix doctor` check**, for T127's reason: detecting this means authenticating
against every running database on every run.

**It does not automate the repair.** A start that failed says what the repair is. Running it is
still a person's decision, exactly as T127 left it.

## Testing

**Unit, `mixengine-daemon::services::databases`.** The matcher of D3, which is the whole of the
risk and needs neither a server nor a keyring:

- PostgreSQL's real line — `2026-09-13 12:00:00.000 +07 [1234] FATAL:  password authentication
  failed for user "postgres"` — with superuser `postgres`, matches, and the line comes back whole.
- The same sentence naming another role — `for user "shop"` — does not match. This is D3.
- MySQL's `Access denied for user 'root'@'localhost' (using password: YES)` with superuser `root`
  matches on `ERROR 1045` where the client prints it.
- A log with no refusal in it answers `None`, and so does an empty one.
- The **last** matching line is the one reported, where a start printed several.

**Unit, `mixengine-proto::state`.** The new reason's sentence joins the table in
`a_reason_explains_itself_in_the_clause_that_follows_a_state`, which enforces that it starts lower
case and ends without a full stop.

**Unit, `mixengine-core::services`.** `StoppedBy::of` answers `Daemon` for it — D8's assertion.

**Unit, `mixengine-cli::render`.** A walk whose failure is a `SuperuserRefused` prints the server's
line and the `mix service reset-credential` line under it, with the service's own id in it.

**Acceptance, `crates/mixengine-cli/tests/postgres.rs`.** The assertion T127 left as a record of the
symptom is what this task turns over. `a_superuser_credential_is_re_set_and_the_databases_are_kept`
already builds the whole situation — a real cluster, a password moved behind MixEngine's back, a
`mix database create` that is refused — so the change is to what it then asserts: the refusal names
the superuser and names `mix service reset-credential`, and no longer merely says the start did not
finish. It runs in CI's `postgres` job (`cargo test -p mixengine-cli --test postgres -- --ignored`),
which is the only place a real PostgreSQL exists, and the comment block recording "this is T127a's
task" goes with it.

No new real-server test is added: the situation this needs is expensive to build and already built
once, in the test that exists to prove the repair.

## What this closes, and where it is written

T127a in
[docs/roadmap/phase-14-a-window-a-new-user-can-start-from.md](../roadmap/phase-14-a-window-a-new-user-can-start-from.md),
ticked with what the task settled.

[docs/architecture/process-supervision.md](../architecture/process-supervision.md)
gains the new reason beside `Uncheckable` and `CrashLoop`, and loses the claim that one variant
carries evidence.

[docs/features/services.md](../features/services.md) gains the sentence a failed
start now says — and loses one it should not have said. Its reset-credential section claims *"the
readiness check of all three of these recipes is an authenticated query"*. Two of them are;
MariaDB's is `mariadb-admin ping`, which answers before authentication, and that difference is the
whole of why this task exists. The sentence is corrected to say which, and what follows from it for
MariaDB — a reset that ends with the server running has proved the server starts on the directory it
wrote into, and the credential itself is proved by the next statement run against it — is stated
rather than implied. Nothing about the repair changes here: that is T127's, and this task found a
sentence rather than a defect.

`bindings/StateReason.ts` is regenerated by `packaging/bindings.sh`.

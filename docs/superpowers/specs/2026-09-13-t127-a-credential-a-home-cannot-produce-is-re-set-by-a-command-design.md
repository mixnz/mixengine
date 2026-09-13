# T127 — a credential a home cannot produce any more is re-set by a command (design)

Roadmap task **T127**, phase 14, following T126: *"A credential a home cannot produce any more is
re-set by a command rather than by hand. The repair is the recipe's own bootstrap — stop the
service, set the superuser's password to the one this home holds, start it — and it differs per
recipe, so it wants a job with a log rather than a paragraph in a hint."*

## What was measured, and how

T126 left the machines that had already met the collision unrepaired, and said so: a server whose
data directory holds a password nothing on the machine knows any more. The whole of this task turns
on one question — **can the password inside an existing data directory be re-set offline, without
destroying the databases in it?** — and on Windows, against a server that was killed rather than
asked to stop, because T126's outage is precisely the case where the shutdown command cannot
authenticate either.

Measured on this machine, 2026-09-13, against the versions this project publishes, downloaded from
its own package index. Each run created a data directory, set password **P1**, wrote a user database
with a row in it, **killed the server** (`Stop-Process -Force`, no clean shutdown), re-set the
password to **P2** with the recipe's own step, restarted, and asserted three things: P1 refused, P2
accepted, and the row still there. Each also carries a control — a deliberately wrong password must
be refused — so that "it worked" cannot be a server that wanted no password at all.

| Recipe | Step measured | Result |
| --- | --- | --- |
| MariaDB 11.4.12 | `mariadbd --no-defaults --bootstrap` | **exit 0, 0.36 s** |
| PostgreSQL 17.11 | `postgres --single -D … postgres` | **exit 0, 0.23 s** |
| MySQL 8.0.44 | `mysqld --skip-networking --init-file=…` | **exit 0, 2.3 s** |

All three passed the verification in full. The three findings that matter are not the exit codes:

**MariaDB's `--bootstrap` accepts a data directory that is already full.** This was the risk the
task was most likely to die on, because `mariadb-install-db` refuses a non-empty datadir — the
finding `STARTED_MARKER` exists for — and it was reasonable to expect the same of the server's
bootstrap mode. It does not: 207 files and a populated InnoDB tablespace, and the `UPDATE
global_priv` ran against them in a third of a second.

**PostgreSQL's `--single` performs its own crash recovery.** Against a cluster that was killed, with
a stale `postmaster.pid` still on disk:

```
LOG:  database system was interrupted; last known up at 2026-09-13 13:24:13 +07
LOG:  database system was not properly shut down; automatic recovery in progress
LOG:  redo starts at 0/1576DF0 … redo done at 0/15F0260
```

and only then the `ALTER ROLE`. Nothing has to clean up after the kill before the repair can run.

**MySQL's step fails while anything still holds the data directory, and says something else.** The
first attempt reported:

```
[ERROR] [MY-012271] [InnoDB] The innodb_system data file 'ibdata1' must be writable
[ERROR] [MY-010020] [Server] Data Dictionary initialization failed.
```

The cause was not the data directory. `mysqld.exe` on Windows **forks a child**, and the harness had
killed the parent by pid and left the child alive holding `ibdata1`. With the child gone the same
command succeeded — XA crash recovery, exit 0. This is what D5 is for, and it is the one thing the
measurement added to the design rather than confirming.

### And one thing that was not being asked about

The hint T126 wrote is matched on `["ERROR 1045", "28P01"]`
(`crates/mixengine-daemon/src/services/databases.rs:200`). `ERROR 1045` appears verbatim in both
MySQL's and MariaDB's client output, measured. **`28P01` never appears at all** — not with the
recipe's own psql arguments, and not with `VERBOSITY=verbose`, because a refused login is a libpq
*connection* failure and never reaches psql's error formatter, which is what would print a SQLSTATE:

```
psql: error: connection to server at "127.0.0.1", port 5433 failed:
FATAL:  password authentication failed for user "postgres"
```

So the sentence this task exists to replace has never reached a PostgreSQL user. D10 is that.

## Goal

One command re-sets a database's superuser password inside its own data directory, so that a server
whose credential nothing can produce any more agrees with this home's keyring again — as a job with
a log, keeping every database on the instance, and asked for explicitly rather than performed on
anyone's behalf.

## Scope

**In:**

- A hook on the ritual a recipe already declares, carrying the steps that re-set an existing data
  directory's superuser credential — MariaDB, MySQL, PostgreSQL.
- `service.reset_credential`, a job of the same kind, and `mix service reset-credential`.
- The two hints in `services::databases::ensure` naming that command.
- Fixing the PostgreSQL half of T126's refusal matcher (D10).

**Out:**

- **The desktop application.** T127 says *by a command*; the window renders the daemon's hint like
  any other, and a button is a later task in its own right.
- **A `mix doctor` check.** See D11.
- **Discarding the data directory.** The second way out of T126's hint stays a sentence; a flag that
  deletes databases is not what "re-set by a command" asks for, and it is a different confirmation.
- **Deleting the pre-T126 keyring entries.** T126 deliberately left them and named `mix doctor` as
  where that becomes visible. A different task.
- **Any change to `SecretAddress` or to the address shape.** T126 settled it.
- **An account's password.** `database.create --password` already realigns one, and can, because it
  authenticates as the superuser. This task is about the credential that realignment needs.
- **Redis and Memcached.** Neither declares a secret; there is nothing to re-set.
- **MySQL 5.6.** It is the one published line that takes `Route::Script`/`ShippedData` rather than
  `Initialize`, so its reset is `bootstrap` rather than `set_the_password`, and it is unmeasured. It
  gets the branch its route already names, and the suite that covers it is 5.7 upward.

## Decisions

### D1 — The repair is declared on the ritual it undoes, not as a new trait method

`Ritual` gains a third field:

```rust
pub struct Ritual {
    pub secrets: &'static [SecretSpec],
    pub steps: fn(&Context) -> Result<Vec<Step>>,
    /// Re-sets those same credentials in a data directory that already exists — T127.
    pub reset: Option<fn(&Context) -> Result<Vec<Step>>>,
}
```

**Not a separate `Recipe::reset` hook**, for the reason `Ritual` itself is one value rather than two:
the credentials a reset writes are the ritual's credentials, named by the ritual's `secrets`, stored
at the ritual's addresses. A recipe that could declare a reset without a ritual could name a
credential nothing generates; a reset whose keys came from somewhere else would be a second opinion
about what this service's superuser is called. One declaration, and the compiler carries the link.

`FirstRun` already holds the `Ritual` and the `Context`, is already what `Generated` carries, and
already knows `data()`, `version()` and `secret_address()`. So it grows `reset_steps(secrets)` and
`reset_budget()` beside `steps` and `budget`, and **the daemon needs no new plumbing to find any of
this** — it asks the same value it asks for a first run.

`Option`, so a future ritual with no offline repair is a typed `Unsupported` rather than a `todo!()`.
All three of today's rituals fill it, and each fills it with a function it already has:

| Recipe | `reset` is | Which is the ritual's steps minus |
| --- | --- | --- |
| MariaDB | `bootstrap` | `install_db`, and the space-free view on Unix |
| MySQL, `Route::Initialize` | `set_the_password` | `initialize` |
| MySQL, other routes | `bootstrap` | `install_db` / `copy_the_shipped_data` |
| PostgreSQL | `set_the_password` | `create_the_cluster` |

That table is the whole reason this task is small. Every one of those steps was written to run a
server that listens on nothing and set a password through it, and every one of them was measured
above against a data directory that already had databases in it.

### D2 — The password is the one this home holds; a missing entry is generated

The reset reads `secret_address(key)` through `crate::secrets`, which is what gives a pre-T126 entry
somewhere to be found, and writes that value into the data directory. It does **not** rotate.

Rotating would work — nothing on this machine caches a superuser password. Measured: there are three
callers of `Context::secret()` and all three are ritual step builders; a pool carries
`EnvValue::Keyring { service, key }` and resolves it at spawn, with a test in `php_fpm.rs` asserting
that the value never reaches the spec at all; `{db_password_env}` renders the variable's *name*;
`handoff::url` writes `&password_env=<NAME>`; and MySQL's `SecretFile` is removed the moment its step
returns. So a rotation would leave nothing stale.

It still is not the default, because a reset is a repair and a repair changes as little as it can.
Where the keyring holds **no** entry — the other failure `services::databases::ensure` already
reports — one is generated and stored before the steps are built, exactly as a first run does and in
the same order, so a machine with no credential store fails before the data directory is touched.
One command therefore answers both of the two shapes this can take.

`--rotate` is permitted by the measurement and is not built here.

### D3 — The proof is the restart, not the exit code

The job succeeds when the service comes back and its readiness check passes, and the readiness check
of all three of these recipes is an authenticated query.

This is not belt and braces. `postgres --single` **exits 0 on a syntax error** — the recipe says so
in its own doc comment, from an earlier measurement — so a reset that trusted the exit code would
report success for a password that was never set, and the next thing to touch the database would
report `ERROR 1045` again from further away. Every step's exit code is still checked, and is still
the first thing that can fail; it is simply not what the job answers with.

### D4 — Only a data directory that is `Ready`

`first_run::inspect` already answers the whole question and its four variants are the whole contract:

- `Ready` — reset. **And this is the state nothing else will repair**: `first_run::ensure` runs on
  every path into a start and returns immediately for a directory that is ready, so a server whose
  password has drifted is not fixed by restarting it. That is why this task exists at all.
- `Foreign` — refuse, exactly as a first run refuses, and touch nothing. A directory MixEngine did
  not create is not one whose superuser MixEngine may rewrite.
- `Empty` or `Unfinished` — refuse, and say the directory needs a *first run* and not a reset. `mix
  service start` is what performs a first run: it bootstraps an `Empty` directory, and clears an
  `Unfinished` one before bootstrapping again. Neither is this command's work, and neither has
  anything to lose.

Refusing `Empty` rather than quietly bootstrapping is the point. The two operations differ in what
they may destroy, and a command that silently became the other one is how a repair turns into a
data-loss report.

### D5 — The service is stopped for the whole of it, and the data directory is proven free first

Three things, in order, and the middle one is what the measurement bought:

1. **Stop it, and wait for the process to be gone** — not for the stop call to return. `service.stop`
   already handles the T126 case correctly: the shutdown command cannot authenticate, the runner
   logs what it said and kills the group (`crates/mixengine-daemon/src/services/runner.rs:1486`).
   The cost is a crash recovery on the next start, which all three servers performed in under three
   seconds in the measurement, and which the job's log says plainly rather than hides.
2. **Assert the data directory is writable before running a step.** `mysqld.exe` forks a child on
   Windows, and a child that outlived its parent answered `The innodb_system data file 'ibdata1'
   must be writable` — a sentence that names a file permission for what is a live process holding a
   handle. The supervisor kills the group, so this should not arise; that is exactly why it needs an
   assertion rather than a hope, and why the failure is reported as *something is still running
   against this data directory* rather than forwarded as InnoDB's own words.
3. **Run the steps, then start it.**

### D6 — Never automatic

Not on a start, not when a probe meets `ERROR 1045`, not inside the post-apply chain.

The design's D3 is that *a keyring entry is the deed of ownership*, and this is the one case in the
system where that deed is wrong: the entry this home holds is, on a machine that met T126's
collision, another home's. Writing it into a server's data directory is the right repair and it is
also an irreversible act performed on the strength of a claim that is known to be unreliable here.
So it is a sentence somebody types, once, about one service.

### D7 — A reset ends with the service running

Whatever state it was in when the repair was asked for, a service that has been re-set is running
afterwards, and the dependents the stop took down are started again with it.

**Not "put back the way it was found", which is what this decision first said.** That reads well and
does not survive D3: the proof that a reset worked is the readiness check, and the readiness check
of all three of these recipes is an authenticated query. A reset that ended with the service stopped
would be a repair reporting success on the strength of an exit code — and `postgres --single` exits
0 on a syntax error. Starting it, proving it, and stopping it again would satisfy both rules and
buys nothing anybody asked for: somebody who types a command to repair a database wants a database
they can use.

So the asymmetry is deliberate and it is only about the *subject*. The dependents are still restored
rather than started: `services::restarted` reads what the stop actually took down, so a dependent
somebody had already stopped stays stopped. It is the named service alone that ends running, because
it is the only one this command makes a claim about.

**Where the steps fail, nothing is started.** A database whose credential is half re-set is not one
to put back in front of an application, and the honest state is a stopped service and a job row
saying why.

### D8 — A stop reason of its own, and it may not be woken

`StateReason` gains a variant for this stop. It is `#[non_exhaustive]`, so a client that predates the
word reads it as no reason recorded rather than failing to parse the event — the same additive path
`Autostart` and `Shutdown` took.

Its own word rather than `Requested`, for `Requested`'s own reason: somebody asked for a *repair*,
not for this service to be down, and a stop that read as a person's would be indistinguishable from
one they meant to last. It also outlives the job where the job fails, and `mix service status` saying
*a person stopped this* about a repair that died half-way is the kind of lie T126 spent a day
chasing.

**And the variant alone does not make it unwakeable — that is a second edit, in a second crate, that
nothing will fail to compile over.** Whether a connection may start a stopped service is
`StoppedBy::may_be_woken`, and `StoppedBy` is a different enum in `mixengine-core` with its own
column: `StoppedBy::of` maps `StateReason::Requested` to `Person` and **everything else to `Daemon`
through a `_` arm**, and `Daemon` *is* wakeable. So a new reason added in `mixengine-proto` and
nowhere else produces exactly the hazard this decision exists to prevent — a connection arriving
mid-reset starting the server against the data directory a step is writing into — and it produces it
silently, because the catch-all arm compiles.

`StoppedBy::of` therefore gains the new reason beside `Requested` in the `Person` arm, and the
assertion in the Testing section is aimed at `may_be_woken()` rather than at the reason word, because
the word is not what the two readers — the web activator and the address holder — consult.

### D9 — `service.*`, not `database.*`

Every `database.*` method today speaks SQL to a **running** server, authenticated as the superuser.
This one stops the server and runs a recipe's steps against files. Putting it in that family would
make the family's one invariant false, and would give `mix database` a subcommand that works on
mariadb, mysql and postgres and on none of the other services it already names.

It belongs beside `service.first_run`, whose shape it copies exactly: a `FirstRun` in, a job out.
Discoverability is not what the namespace buys — the hint names the command, which is the path
anybody meeting this will actually take.

### D10 — The PostgreSQL half of T126's refusal matcher is fixed here

`28P01` never appears in psql's output, so today only the MySQL family gets the explanation. The
matcher gains PostgreSQL's actual prose — `password authentication failed` — alongside the two
codes, and a test asserts against the measured string rather than against a guess.

**Kept as a match on output rather than replaced with something structural**, because there is
nothing structural to match: the step runs a client and reads what it printed, and psql's exit code
for a refused login is `2`, which is also its exit code for a file it could not open.

This does not belong to T127 by rights. It is here because T127's whole purpose is to make that hint
name a command, and a hint nobody sees is not worth naming a command in.

### D11 — No `mix doctor` check

Detecting this condition means authenticating against every running database instance, on every
doctor run. And the repair is a multi-minute stop-and-restart with a log, while `DoctorRepair` is
shaped for a short synchronous act returning a `RepairReport` — *"a job with a log rather than a
paragraph"* is what T127 asks for and what `doctor_repair` cannot give it.

What is given up: a machine that has this problem still reports healthy until somebody touches a
database. That is accepted because the condition already announces itself at the moment it matters —
the provisioning probe — and that announcement is what D10 repairs.

## Testing

**In the recipes, without a machine:**

- Each of the three rituals declares a `reset`, and the steps it builds contain **no** step that
  creates a data directory — asserted by naming the programs, because the failure being guarded
  against is a reset that runs `initdb` over a live cluster.
- The reset's steps and the ritual's password-setting step are the same value for each recipe.
- A credential that is not alphanumeric is refused by the reset exactly as the ritual refuses it;
  the guard is in the shared step builder and must not be bypassed by the new caller.
- MySQL's reset follows `route()`, measured on both `windows = true` and `false`, so the 5.6 branch
  is exercised on a machine that is not running 5.6.

**In the daemon:**

- `Foreign`, `Empty` and `Unfinished` are each refused, with the message that names what to do
  instead, and the directory is untouched afterwards.
- A missing keyring entry is generated and stored **before** the first step runs — the ordering
  assertion `first_run` already carries, for the same reason.
- The job's outcome is `Failed` when the service does not come back ready, even where every step
  exited 0. This is D3, and it is the assertion that a `postgres --single` syntax error cannot pass.
- The stop reason is not wakeable, and `hold_if_wakeable` binds nothing for a service stopped by a
  reset.
- A service that was stopped when the reset was asked for is stopped when it finishes.

**Against real servers**, in `crates/mixengine-cli/tests/{mariadb,mysql,postgres}.rs` — the
reproduction of T126's own outage, which is the acceptance criterion:

1. Bootstrap the instance and provision a database with a row in it.
2. Overwrite the keyring entry with a different value — this is the collision, without needing a
   second home.
3. Assert the server refuses: `database.create` fails, and the message is the one D10 produces, for
   PostgreSQL as well as for the MySQL family.
4. `service.reset_credential`.
5. Assert the server serves: the superuser authenticates, and **the row from step 1 is still there**.

Step 5's second half is the one that matters most. Every other assertion here would also pass for an
implementation that threw the data directory away.

**Not tested here:** MySQL 5.6 against a real server, and the `--rotate` that D2 declines to build.

## What this closes, and where it is written

- Roadmap task **T127** in
  [.claude/roadmap/phase-14-a-window-a-new-user-can-start-from.md](../../../.claude/roadmap/phase-14-a-window-a-new-user-can-start-from.md).
- [.claude/features/services.md](../../../.claude/features/services.md) gains the reset beside the
  first-run ritual: the two operations that write a credential into a data directory, and what
  separates them.
- [.claude/features/client-surface.md](../../../.claude/features/client-surface.md) gains
  `service.reset_credential`, so a full graphical client knows the capability exists even though
  this task draws no screen for it.
- **No ADR.** T126's
  [0032](../../../.claude/decisions/0032-a-keyring-address-names-the-home-it-belongs-to.md) already
  settled the cross-cutting question — what a credential's address means. This task carries out the
  repair that record's own consequences require, and adds no rule anything else has to obey.

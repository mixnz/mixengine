# T97 — The active front end is answerable, and switchable (design)

Roadmap task **T97**, phase 10, designed by
[ADR 0026](../../../.claude/decisions/0026-the-active-front-end-is-a-row-and-switching-it-is-a-job.md).
It closes the second half of the one acceptance criterion
[client-surface.md](../../../.claude/features/client-surface.md) currently fails — the Settings
screen's *"default web server"* has nothing behind it, so a client can only get at the fact by
hardcoding that the package names `caddy` and `nginx` mean "front end". The first half was **T96**.

The two halves of this task are not the same size and the roadmap says so. Reading is one member on
a response. Writing is a job that can end with the home **where it started**, and the whole of the
design below is about making that outcome describable rather than accidental.

Five things this design settles that neither the roadmap sentence nor ADR 0026 fixes: the grant is
asked for **before** anything is touched and a switch that would make the home worse is refused
(D4); a create that will not render **puts the old row back** (D6); only what is a statement about
*the home's front end* travels to the new row (D7); the new front end is started **only if the old
one was running** (D9); and one front-end row change happens at a time (D10).

## Goal

Somebody on the Settings screen sees which web server their sites are reached through, because the
daemon said so, and can move to the other one with a button. On a machine that grants the new server
port 80 they end up on it, with their sites rendered for it and running. On a machine where nobody
grants they end up **exactly where they were**, told why, with the grant waiting so that allowing it
and asking again works.

From `mix`, that is `mix service front-end` and `mix service set-front-end nginx`.

## Scope

**In:**

- `mixengine-proto`: `service_api.rs` — `ServiceRole`, `ServiceSummary::role`, `FrontEndSwitch`,
  `FrontEndReport`, `FrontEndOutcome`; one method name on `rpc::method`.
- `mixengine-core`: `generate::program` — the one spelling of a package's executable, extracted from
  `Context::program`; `services::declaration` — a row read back as the value `services::create`
  takes.
- `mixengine-daemon`: `api/front_end.rs` (the walk), `api/create.rs` (the inner create and delete,
  and the lock), `api/rpc.rs` (dispatch, and `summary` gaining the role), `api/mod.rs` (the lock).
- `mixengine-cli`: `mix service front-end`, `mix service set-front-end`, their confirmation and
  rendering.
- Docs: `client-surface.md`'s Settings paragraph and acceptance-criteria paragraph, `services.md`'s
  catalogue note, the `service.*` line in `daemon-and-ipc.md`, the phase 10 tick, the handbook's
  `services.md` in both locales, and `docs/guide/en/cli.md` regenerated.
- TypeScript bindings: `bash packaging/bindings.sh`.
- Tests: unit tests beside each new function, and `crates/mixengine-cli/tests/front_end.rs`.

**Out:**

- **A `settings.*` namespace, and a `front_end` field in `config.toml`.** Both are refused by ADR
  0026's *Alternatives considered*, and this design adds neither.
- **Changing which *version* of the current front end runs.** `service.set_front_end caddy` on a
  home already on Caddy is `Unchanged`, whatever version is named — see D11. Moving a front end
  between versions of one package is `service.delete` plus `service.create` and has no task.
- **Installing the package being switched to.** A switch that downloaded forty megabytes is not the
  operation anybody pressed a button for — D12.
- **Revoking the port-access grant from the binary being left behind.** T42's D12 stands: nothing in
  this build revokes but `daemon.uninstall` — D5.
- **A third front end.** Adding one is adding a recipe; nothing here is a list of two.
- **A new event.** `service.create` and `service.delete` announce nothing today and this composes
  them — D14.

## The types

```rust
/// What a service is *for*, where two packages can be for the same thing — roadmap task **T97**.
///
/// The wire half of `mixengine_core::generate::Role`, which is what `Recipe::role` answers.
#[serde(tag = "role", rename_all = "snake_case")]
pub enum ServiceRole {
    /// The program every site on this machine is reached through, and which of the two it is.
    FrontEnd { server: FrontEndServer },

    /// Everything else: a database, a cache, a pool.
    Other {},
}

pub struct ServiceSummary {
    // … as it is today …

    /// What this service is *for* — roadmap task **T97**.
    ///
    /// **A wire fact, not a domain one**: `None` means this daemon predates the member, never that
    /// the role could not be determined. A row whose package this build has no recipe for is
    /// `Other`, because a service it cannot configure is not the program sites are reached through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<ServiceRole>,
}

/// What `service.set_front_end` takes.
#[serde(deny_unknown_fields)]
pub struct FrontEndSwitch {
    /// Which program every site should be reached through from now on.
    pub server: FrontEndServer,

    /// Which installed version of it. The newest installed when absent — D3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<PackageVersion>,

    /// Flush the elevation queue in this same call, raising the one prompt.
    ///
    /// **Defaults to `false`**, on `UninstallQuery::grant`'s rule and for its reason: what is about
    /// to be allowed is read before it is allowed (T64). A switch that needs a grant it was not
    /// allowed to raise answers `NotGranted` with the operation waiting.
    #[serde(default)]
    pub grant: bool,
}

/// What a switch did, measured after it — not a claim about what was attempted.
pub struct FrontEndReport {
    /// What the home was reached through when the call began. `None` for a home that had none.
    pub was: Option<ServiceId>,

    /// What it is reached through now. Equal to `was` whenever nothing moved.
    pub now: Option<ServiceId>,

    /// What happened, and why.
    pub outcome: FrontEndOutcome,

    /// Whether the front end named by `now` may bind 80 and 443 on this machine.
    ///
    /// **A measurement of the home afterwards**, taken whatever the outcome. `false` is the
    /// degraded mode of ADR 0005 and not a failure of this call — a Linux home where nobody has
    /// granted `cap_net_bind_service` has a front end that will not start, and it had one before
    /// this was called too.
    pub answering: bool,

    /// The old front end's data directory, kept. `service.delete`'s rule, and `None` when there was
    /// none on disk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kept_data: Option<String>,

    /// What did not travel to the new row, one sentence each — D7. Empty when the old row carried
    /// nothing that could be left.
    pub not_carried: Vec<String>,
}

#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum FrontEndOutcome {
    /// It was already the front end. Nothing was stopped, deleted, created or started.
    Unchanged {},

    /// Done. `started` is the walk that brought the new front end up, and `None` when the old one
    /// was not running and nothing was started in its place — D9.
    Switched { started: Option<ServiceWalk> },

    /// This machine will not let the new front end answer on 80 and 443 and the old one could, so
    /// the home was left where it was — D4.
    NotGranted { because: String },

    /// Something failed after the old row had gone, and the old front end was put back — D6.
    RolledBack { because: String },

    /// Something failed and the home could not be put back either. `now` says what is there, which
    /// may be nothing at all.
    Failed { because: String },
}
```

`FrontEndReport::moved()` is true for `Switched` alone; `FrontEndReport::wanted_more()` is true for
`NotGranted`, `RolledBack` and `Failed`, and is `mix service set-front-end`'s exit code —
`UninstallReport::left_behind`'s rule.

## Decisions

### D1 — The reading is a member, and it is optional on the wire

ADR 0026 settles that it is a member on `ServiceSummary` rather than a method of its own: the list is
already answering, and `client-surface.md`'s own acceptance criterion rules out a method that exists
to serve one screen.

`Option<ServiceRole>` with `#[serde(default, skip_serializing_if)]` is **ADR 0019** applied without
an exception. `None` is *"this peer was built before the member existed"* and never *"could not
determine"* — a package this build has no recipe for is `Other`, decided rather than absent, which is
the same answer `front_end::held_by` already gives such a row when it passes over it.

`mixengine-proto` gains a floor fixture for `ServiceSummary`: the member set as a daemon before this
task sent it, hand-written as JSON, decoding with `role: None`. `DaemonStatus` has had one since
T88c; this is the second, and the rule ADR 0019 ends on is that each type that grows members carries
one.

### D2 — The role carries *which* server, so no client ever spells `caddy`

`ServiceRole::FrontEnd { server }` and not a bare `front_end`. Without the payload a client that
wanted to draw a two-way radio would be back where it started: it would have the fact that `caddy` is
a front end and no way to name the other one but by writing the string. With it, the value it reads
off the active row is the value it sends to switch — `FrontEndServer` is one enum, generated into
`bindings/`, and ADR 0026's enforcement clause ("no client may map a package name to a role") is
something a client can actually obey.

`Other {}` and not `Other`, for the reason `PrivilegedOp::Probe {}` is written that way: serde reads
a unit variant of an internally tagged enum through `deserialize_any`, where an unknown-field rule
never fires. A struct variant is read as a struct.

### D3 — The version is the newest installed unless one is named

`service.create` takes a version because a person creating a service is choosing one. Nobody pressing
*"use nginx"* on a Settings screen is choosing between nginx 1.27.3 and 1.27.4, so `version` is
optional and the daemon picks the newest installed by `PackageVersion::cmp_precedence` — the same
comparison the blueprint planner already makes when it picks a runtime, rather than a second
opinion about what "newest" is.

A `version` that is named and not installed is `precondition_failed` naming it. **No version
installed at all is `precondition_failed` with the install command in the hint** — the switch
installs nothing (D12).

### D4 — The grant is asked for first, and a switch that would make the home worse is refused

This is the half ADR 0026 calls *"not the same size"*, and the outcome it forbids is *"a home whose
sites are rendered for a server that cannot answer"*.

So the port-access question is asked **before anything is stopped, deleted or created**. The new
front end's binary is `<install_path>/<package><EXE_SUFFIX>` — computable from the `packages` row
without a `services` row existing, which is what makes "ask first" possible at all — and
`PortAccess::probe` is asked about it. Three answers:

- **Granted, or nothing to grant.** macOS redirects by port and the anchor carries over whichever
  program binds 8080; Windows reserves nothing below 1024. The switch proceeds with no prompt, which
  is what makes this a Linux-only cost rather than a dialog on three operating systems.
- **Not granted, and the grant lands.** `PortAccessGrant { plan }` is enqueued and — only if
  `grant` was asked for — `Elevation::grant_within` raises the one prompt inside this job, exactly as
  `cert.ca_rotate` (T54) and `daemon.uninstall` (T87) do. The binary is probed again afterwards,
  because what the helper did is a fact to read and not a return value to trust.
- **Not granted, and it stays that way** — declined, no helper, no way to prompt, or `grant: false`.

**And the third answer is not automatically a refusal.** The rule is *do not make the home worse*,
not *require a grant*. So the old front end's binary is probed too:

| new | old | what happens |
|---|---|---|
| granted | — | switch |
| not granted | granted | **stay** — `NotGranted`, nothing touched |
| not granted | not granted | switch, and `answering: false` says so |
| not granted | there is no old front end | switch, and `answering: false` says so |

The second row is ADR 0026's *"a machine where nobody grants stays on the front end it had"*. The
third is the case that sentence does not cover and would get wrong: a Linux home where nobody ever
granted has a front end that fails to bind 80 and does not start, and refusing to move would trap
somebody on a server that cannot answer in order to protect them from a server that cannot answer.
The fourth is the same case with nothing to protect.

**A refused switch leaves its grant standing, and that is the useful behaviour.** The queue is
whole-state per operation, so the entry now names the binary the person was aiming at:
`mix elevation grant` followed by the same command works, with no second prompt raised by anything in
between. The next daemon start supersedes the entry with the front end the home is actually on if
that one needs a grant — `require_port_access` runs at every start and already does this.

**`grant_within` flushes the whole queue and that is the established contract**, not something this
method introduces: one prompt spends the batch (ADR 0005). It is why `grant` defaults to `false` and
why `mix` says out loud that a permission prompt may appear before it sends `true`.

### D5 — Nothing is revoked from the binary being left behind

The tempting move is to put `PortAccessRevoke { target }` in the same batch as the grant and spend
one prompt on both. It is refused for a reason stronger than tidiness:

**The batch is not atomic.** `PrivilegedResponse::results` is one outcome per operation, and the
helper validates each on its own. A batch where the revoke succeeds and the grant does not leaves a
home that has just been told it is staying on Caddy — with Caddy's capability gone. That is strictly
worse than the state the switch was refused to preserve.

So T42's D12 stands unchanged: this build asks in one direction only, and `daemon.uninstall` (T87) is
the producer that takes it back. What is left behind is `cap_net_bind_service` on a binary nothing is
running, inside a directory `package.uninstall` removes whole. Switching *back* later then costs no
prompt at all, which is a small kindness rather than the reason.

### D6 — Delete before create, and a create that will not render puts the old row back

The order is ADR 0026's and its reasoning is `front_end::held_by`'s: creating before deleting would
make "exactly one front end" momentarily false and would need an exception carved into the refusal
for its own caller.

The cost of that order is a window in which the home has no front end, and the step inside it can
fail: `service.create` renders the whole declared set before it answers, and a front-end recipe
renders through a validator — `nginx -t`, `caddy validate`. **That is the good news and the reason
this is survivable**: a configuration the new program refuses is caught at the one step that is still
undoable, rather than at a start that fails an hour later.

So the old row's `Declaration` is read back *before* it is deleted, and a create that fails restores
it: the same row, the same port column, the same overrides, the same data directory, re-rendered, and
started again if it had been running. `mixengine_core::services::declaration` is the reader — the
inverse of `services::create`, taken from the row rather than reassembled by a caller, so the two
cannot drift.

Three endings, and each is named:

- the create succeeded — `Switched`;
- the create failed and the restore worked — `RolledBack { because }`, where `because` is what the
  create said;
- the create failed and the restore failed too — `Failed { because }`, with `now` reporting what
  `held_by` says is there, which may be nothing. This is the outcome nothing can prevent, and the
  report exists so that it is a sentence on somebody's screen instead of a home that quietly stopped
  serving.

**A failed *start* is not rolled back.** By then the configuration has validated with the new
program, so what failed is a machine condition — a port held by something else, a binary the
antivirus quarantined — and undoing it would take the home through a second full swap for a condition
the old front end may share. It is reported as `Switched { started: Some(walk) }` with the walk
carrying its own failure, which is the value `service.start` already answers with and a client
already renders.

### D7 — Only what is a statement about *the home's front end* travels

The new row is a new service. What carries over is what is about a **job** rather than about a
**program**:

| carried | left | why |
|---|---|---|
| `bind_addr` | | which address this home's front end answers on is not a fact about Caddy |
| `autostart` | | "the front end comes up with the daemon" is the same wish for either program |
| | `config_overrides_json` | a Caddyfile setting is a syntax error in `nginx.conf`; the two recipes do not share a vocabulary |
| | `data_dir` | those are that program's files, and `service.delete` keeps them where they are |
| | `limits_json` | a ceiling was measured against the program that is going |
| | `idle_minutes` | so was an idle policy |
| | `port` | neither front end has a port column: 80 and 443 are their own settings |

**And what is left is named.** `not_carried` carries one sentence per item the old row actually held,
so a person who had capped Caddy at 256 MB reads that rather than discovering it. A silently dropped
override is the failure mode this whole table exists to avoid; a listed one is a thing somebody can
put back with `mix service set-limits`.

### D8 — The switch does not force past a site that declares the front end

`service.delete` refuses when a site declares the service and offers `--force` to cross it, because
"somebody who has been shown the sites is entitled to overrule". A switch has shown nobody anything,
so it does not get to overrule: a site with an explicit link to `caddy` is a `precondition_failed`
naming the sites, exactly the error `service.delete` gives, checked **before the old front end is
stopped**.

Checked twice, on `daemon.cleanup`'s rule (T96 D6): once in the handler so the refusal is a plain
error rather than a job somebody has to go and read, and again by the inner delete, which is the same
code path `service.delete` uses and cannot be forgotten.

This is a rare shape — a site's `services` are its databases and caches, and an extension's front-end
fragment is rendered by the recipe rather than linked — which is why refusing costs nothing and
inventing a second policy would.

### D9 — The new front end is started only if the old one was running

ADR 0026's walk ends *"and start it"*. Taken literally that starts a server on a home where somebody
had deliberately stopped theirs, which is the tool overruling its user — the same sentence T70 writes
about idle activation, at a different scale.

So the switch preserves what it found. The old front end running means the new one is started; the
old one stopped, or absent altogether, means the new one is created and left stopped, and
`Switched { started: None }` says so. A home being given its **first** front end therefore gets a row
and a rendering and nothing running, which is consistent with `services.md`'s *"Nothing installs a
front end"* — this method declares one, it does not decide the home wanted a web server up.

### D10 — One front-end row change at a time

Between the delete and the create the home has no front end, and `service.create`'s refusal is what
enforces "exactly one" — so in that window a concurrent `service.create nginx` is *accepted*, and the
switch's own create then fails with a refusal it caused itself, with nothing to roll back to.

A `tokio::sync::Mutex` on `Api` closes it. It is taken by `service.create` when the recipe answers
`Role::FrontEnd`, by `service.delete` when the row being deleted is one, and held across the whole
switch. Everything else — every database, every cache, every pool — never touches it, so the cost is
nothing on the calls that outnumber these thousands to one.

It is a lock and not a job-level refusal because the two callers are different methods; the switch
additionally refuses a second `service.set_front_end` with `conflict` naming the job, which is the
same shape `elevation.grant` uses for its one slot and gives a person a better message than a call
that blocks.

The bodies of `service_create` and `service_delete` become inner functions the lock's holder calls,
so that the switch reuses every refusal they carry — T32's, T36's, T37's, the data directory that is
kept and named — rather than a second implementation that would drift.

### D11 — The same server is `Unchanged`, whatever version is named

`service.set_front_end caddy` on a home already on Caddy stops nothing, deletes nothing and creates
nothing. It is not an error: a Settings radio being clicked on the option that is already selected is
an ordinary thing to happen, and answering `precondition_failed` would make a client suppress the
call, which is the client deciding.

It is `Unchanged` **even when `version` names a different installed Caddy**. This method switches
which program a home is reached through; moving between versions of one program is a different
operation with different consequences — the data directory is that version's, the row is the same row
— and pretending one method does both would mean a caller could delete and re-create their front end
by mistyping a patch number.

### D12 — The switch installs nothing

A `server` whose package has no installed version is `precondition_failed` with
`mix package install nginx <version>` in the hint. The alternative — a job that resolves the index,
downloads and unpacks before it swaps — turns one button into a network operation with a progress bar
and a different set of failures, and buries `package.install`'s own consent inside a method about
something else. A client that wants the one-click version composes the two calls and shows both.

### D13 — `mix service front-end` reads the list; there is no second method

ADR 0026 rules out a method to answer a question the list already answers, and the CLI obeys the same
rule it puts on a graphical client: `mix service front-end` calls `service.list` and picks the row
whose `role` is `FrontEnd`. That is filtering on a value the daemon supplied, not mapping a package
name to a meaning — which is the line the ADR's enforcement clause draws.

A daemon too old to send `role` makes every row `None`, and the command says *"this daemon does not
report what a service is for"* rather than guessing. That is ADR 0019's cost paid once, in the one
place that reads the member.

### D14 — No new event, and no protocol bump

`service.create` and `service.delete` announce nothing today; a switch is those two and a walk, and
the walk's own `ServiceStateChanged` events are published as they always are. The rule
`mixengine-proto`'s event module states — *events are best-effort and must never be the only way
state is learned* — is what makes that enough: a client following the job re-reads `service.list`
when it finishes, which is what it does after every other mutation.

`PROTOCOL_VERSION` does not move. One method added, one member added and made optional (D1), nothing
removed and no meaning changed — ADR 0019's list of what does bump has none of those on it.

### D15 — `mix service front-end` and `mix service set-front-end`, under `service`

Not `mix front-end`, where `mix disk` and `mix cleanup` sit. Those are about the home as a whole; this
is about a `services` row — the same row `mix service status caddy` describes — so it belongs to the
namespace that owns rows. The roadmap names both commands in exactly this form.

`mix service set-front-end <caddy|nginx>` prints what is about to happen, that every site is
unreachable while it happens, and that this machine may ask permission for the new server to answer
on 80 and 443; then asks, unless `--yes`. `--json` without `--yes` refuses to act rather than
skipping the question, on `mix cleanup`'s rule. `--no-wait` prints the job and returns. The exit code
is non-zero for `NotGranted`, `RolledBack` and `Failed`.

## Data flow

**`service.list` / `service.status` / `service.create` / `service.delete`**

`summary()` gains a `&Catalogue` and fills `role` from `recipe.role()`, mapping
`generate::Role::FrontEnd(server)` to `ServiceRole::FrontEnd { server }` and everything else —
including a package with no recipe — to `Other {}`. The catalogue is built once per call and not once
per row.

**`service.set_front_end`**

Handler, before any job exists:

1. `FrontEndServer::package()` → the package name. Installed versions are read; none, or the named
   one missing, is `precondition_failed` (D3, D12).
2. A `service.set_front_end` job already running is `conflict` naming it (D10).
3. The current front end is read (`front_end::held_by`). A site declaring it is `precondition_failed`
   naming the sites (D8).
4. `jobs.begin`.

The job:

1. **5%** — take the front-end lock. Re-read the current front end under it. Same server →
   `Unchanged` and return (D11).
2. **15%** — read the current front end's `Declaration`, its `ServiceRecord` and whether it is
   supervised. This is the rollback material and it is taken before anything moves (D6).
3. **25%** — `program(install_path, package)` for the new front end; `probe` it. Not granted →
   enqueue `PortAccessGrant`, and if `grant` was asked for, `grant_within(handle)`, then probe again.
   Probe the old binary. Refuse per D4's table → `NotGranted`, nothing touched.
4. **40%** — stop the old front end, if it is running or supervised: the same stop plan
   `service.stop` walks. A stop that does not reach it ends the job here, with nothing deleted.
5. **55%** — delete the old row and `etc/<old-id>/` through the inner delete. `data_kept` is carried
   into the report.
6. **70%** — create the new row through the inner create, with `bind_addr` and `autostart` carried
   and nothing else (D7). **This is the re-render**: `service.create` renders the whole declared set,
   which is `sites/` for the new front end, so ADR 0026's separate re-render step is this step and a
   second `reconfigure()` would write nothing. A failure restores the old row and reports
   `RolledBack`, or `Failed` if the restore failed too (D6).
7. **85%** — start the new front end if the old one was running (D9).
8. **95%** — probe once more for `answering`, read `held_by` for `now`, and build `not_carried` from
   the old declaration.

## Testing

**`mixengine-proto`** — wire shapes: `ServiceRole` round-trips tagged in both variants; a
`ServiceSummary` from before this member decodes with `role: None` (the floor fixture, D1); a
`FrontEndSwitch` from `{"server":"nginx"}` has no version and does not grant; `{"grant":true}` with a
misspelled neighbour is refused by `deny_unknown_fields`; each `FrontEndOutcome` round-trips;
`wanted_more()` is true for exactly `NotGranted`, `RolledBack` and `Failed`.

**`mixengine-core`** — `generate::program` spells the executable the way `Context::program` does on
this OS, asserted through both so the two cannot diverge; `services::declaration` reads back what
`services::create` wrote, for a row with overrides, a data directory and a fixed port, and reports
`NotFound` for an id with no row.

**`mixengine-daemon`** — against the test home:

- a `service.list` on a home with a front end and a database carries `FrontEnd { server }` on the
  first and `Other` on the second, and the assertion is written with **nginx** so that a lookup which
  had happened to be a comparison against `caddy` fails it — `front_end::held_by`'s own test rule;
- a switch on a home whose mock host grants port access moves the row, keeps the data directory and
  reports `Switched`;
- a switch on a mock host that will not grant, from a front end that **is** granted, changes nothing
  and reports `NotGranted` — and the grant it asked for is in the queue afterwards;
- a switch on a mock host that will not grant, from a front end that is **not** granted either,
  moves the row and reports `answering: false` (D4's third row);
- a switch to the server the home is already on is `Unchanged`, and nothing was stopped;
- a switch whose create cannot render puts the old row back, and `held_by` names it again
  (`RolledBack`) — driven by a recipe fixture whose render fails;
- a switch on a home with no front end at all creates one and leaves it stopped;
- a switch to a package with no installed version is `precondition_failed` naming the install
  command;
- a site declaring the current front end refuses the switch and the front end is still running;
- `autostart` and `bind_addr` are on the new row, and an override that was on the old one is not —
  and is named in `not_carried`.

**`mixengine-cli`** — `crates/mixengine-cli/tests/front_end.rs`, against the shared harness:
`mix service front-end --json` parses as a `ServiceSummary` whose role is `FrontEnd`; on a home with
none it says so and exits zero; `mix service set-front-end nginx --json` without `--yes` refuses to
act; `mix service set-front-end` on the server already active exits zero and prints that nothing
moved.

**Docs** — `bash packaging/docs.sh --reference` regenerates `cli.md` and CI's diff is the gate;
`bash packaging/bindings.sh --check` is the gate for `bindings/`; the Vietnamese handbook page is
translated and restamped.

## Risks, and where each is answered

| risk | answer |
|---|---|
| The home ends with no front end at all | D6: the old declaration is read before the delete and restored on a failed create |
| The home ends rendered for a server that cannot bind 80 | D4: the grant is asked for before anything moves, and a switch that would make it worse is refused |
| A machine that will not grant traps somebody on a front end that cannot answer either | D4, third row: that switch proceeds and `answering: false` says what it is |
| One prompt is spent on operations nobody was shown | D4: `grant` defaults to false, and `mix` says a prompt may appear before sending true |
| The old binary keeps a capability nobody re-consented to | D5: accepted, T42's D12; `package.uninstall` removes the binary, `daemon.uninstall` the grant |
| A concurrent create lands in the window where there is no front end | D10: one front-end row change at a time |
| A Caddyfile override is carried into an `nginx.conf` | D7: overrides do not travel, and what did not travel is named |
| A switch quietly starts a server somebody had stopped | D9: started only if the old one was running |
| A switch deletes a service a site is pointing at | D8: refused, twice, with the sites named |
| A client hardcodes `caddy` to draw the switch | D2: the role carries the server, and it is the value the switch takes |
| An older daemon breaks a newer `mix` | D1: the member is optional, with a floor fixture in `mixengine-proto` |

## What this leaves

**A front end cannot be moved between versions of its own package**, which is D11's boundary rather
than an oversight: `service.delete` plus `service.create` does it, and whether that deserves a verb
of its own is a roadmap question and not this task's.

**`packages/` is still not offered as a thing to reclaim** and **the switch still installs nothing** —
both deliberate, both above.

**A third front end needs a recipe and nothing else.** `ServiceRole` carries `FrontEndServer`, which
is the enum a fourth variant would join; nothing in the daemon, the CLI or the bindings holds a list
of two.

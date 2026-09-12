# Phase 14 — A window a new user can start from

*Goal: somebody who has just installed MixEngine gets a working website from one button, keeps it
after a reboot, and can find the settings they need without being told where they are.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-11-a-window-a-new-user-can-start-from-design.md](../../docs/superpowers/specs/2026-09-11-a-window-a-new-user-can-start-from-design.md).

---

**One API hole, one planner that stops an action short, and two affordances.** The phase is written
against four complaints from somebody using the finished product: a new user cannot get a site
without six manual actions, PHP extensions cannot be found, nothing comes back after a reboot, and
the sidebar is eleven flat items. Only the third is a missing method —
[client-surface.md](../features/client-surface.md) §4 has claimed a service's `autostart` was a
readable, writable setting since it was written, and nothing has ever read the column.

## The API hole

- [x] **T112** A service says whether it starts with MixEngine, and can be told to (D1).
      `ServiceRecord.autostart` from one more column in `core::services::record` and `records`;
      `ServiceSummary.autostart`; `service.set_autostart` beside `service.set_idle`.
      `mix service autostart <id> --on|--off` — not `mix autostart`, which is T85b's and is about
      the daemon — and an `AUTOSTART` column in `mix service list`. Bindings regenerated.
      **Three things this task settled.** The column is read in `ServiceRecord` and not in
      `Declaration`, which also carries it: `declaration` is a four-table join per service, and a
      listing that paid for one per row to report one boolean would be quadratic in what it
      reports — so the one *setting* in that struct travels with the readings a supervisor wrote,
      because they come out of the same statement. The method answers a `ServiceSummary` rather
      than a report of its own, unlike `service.set_idle` beside it, and the asymmetry is the
      point: an idle policy has four readings that all look alike from outside and needs a type to
      tell them apart, where this is a column with two values that a summary already carries.
      And `render::service_autostart` prints two lines rather than one word — a person reading
      `no` beside a service that does start at every login is a person the setting has misled, so
      the second line says that a start plan pulls in what the flagged services depend on.
      `mixengine_testkit::call` became public here, on `create`'s own reasoning: a suite that wants
      a method with no fixture helper should send the call a person sends.

- [x] **T113** The daemon starts what asked to start (D2, D3, D4). `crate::services::autostart`:
      `start_plan` over the flagged ids, so a dependency without the flag is brought up by a
      dependent with it. Spawned in `serve` after `services.recover()` **and after the endpoint is
      serving** — the one member of the sweeper family that starts last, because it runs real
      programs and a daemon that will not answer `daemon.status` until MariaDB's first run has
      finished looks hung. One attempt, no retry; `StateReason::Autostart`.
      **What this task settled.** The reason belongs to the *first life* and to nothing else, which
      is what kept the change out of the supervision hot path: `Registry::start_because` is a thin
      wrapper over the existing walk, and the parameter reaches `begin`, `supervise` and
      `Runner::run` and stops there — every life after the first one has a reason the restart
      policy decides, and the caller does not get to name those. The `adopt` path takes no reason at
      all, because there is no first life to explain. And each *read* failure ends the walk rather
      than starting the part it could work out: a home whose rows or graph cannot be read has no
      answer to "what asked to start", and starting a guess at it is worse than starting nothing.

- [x] **T114** The desktop shows it and sets it (D5). The switch in `screens/ServicesDetail`, in one
      panel with the idle timeout and one line between them saying the two answer different
      questions; the value in the Dashboard's service table.
      **Two things this task settled.** The panel has no *Save* button, where `IdlePanel` beside it
      does, and the difference is what each is: idle is three states and a number somebody types,
      so it needs one confirmation; this is one column with two values, and a switch you have to
      press Save after is a switch people think they have already set. And it reads its value from
      `service.list` rather than from a read method of its own — `ServiceSummary` carries the column
      since T112, so a second backend command asking about one service would only be a second place
      for the answer to drift. The Dashboard's column sits beside `State` and not at the end, on
      `mix service list`'s reasoning: the two together are the question somebody scanning the table
      is asking.

## The first site

- [x] **T115** A blueprint with a site can be asked for something to serve it (D6). `core::sites` is
      explicit that "a home with no front end renders nothing and this succeeds", so
      `blueprint.apply wordpress` on a fresh machine ends with a project, a database, a site row, a
      domain, a certificate — and nothing listening;
      [services.md](../features/services.md) already named the gap — *"a first run that offers to do
      it for them is not built and has no task of its own yet"*. The planner learns one rule,
      expressed with the `InstallPackage` and `EnsureService` variants that already exist: no new
      `PlanAction`, no new manifest key.
      **Three things this task settled, and the first is a correction to its own design.** The rule
      was written as *always* and is shipped as *asked for* — `BlueprintApply.front_end`,
      `mix blueprint apply --with-front-end`, defaulted off. What said so was
      `crates/mixengine-cli/tests/blueprint.rs`, which is offline by construction and whose every
      apply suddenly reached the package index for a web server none of those tests is about; the
      finding generalises past the suite, because an apply is about a *project* and provisioning the
      machine it runs on is a wider thing. Second, the instance name comes from the recipe's own
      `Instancing` and not from a convention here: a front end is `Single`, so a hardcoded `"main"`
      planned a step `service.create` was guaranteed to refuse — *there is one caddy, so its id
      carries no `@`*. Third, `the_steps_are_in_dependency_order` was asserting one rank per action
      *kind* and only looked right because its fixture had one service: install, ensure and
      create-database are one tier, walked a service at a time, and the ordering inside that tier is
      now asserted per package. `plan()` took its parameters as a `Wanted` struct in the same
      stroke, because the ninth argument is where clippy stops counting.

- [x] **T116** An apply can hand on the autostart flag (D7). `BlueprintApply.autostart`, defaulted
      **false** — the default is a constraint and not a taste, because `warm_start.rs` times a
      single `mix service start` and a boot walk racing it would make the `bench` job meaningless.
      Set on every service the apply creates, on nothing it finds. `mix blueprint apply --autostart`.
      **Two things this task settled.** "Only what this apply made" is true by construction rather
      than by a check: the flag is read on the `EnsureService` branch that *creates* an instance,
      and a step that planned `Satisfied` never reaches `service.create` at all — which also makes a
      second apply of the same blueprint set nothing. And the flag needed a fixture with a service
      and **no** `[site]` (`tests/fixtures/with-a-service.toml`), because T115 plans a front end for
      a manifest that has one and this suite is offline: `fakeservice`'s package row is already
      there from `declare::package`, so the install plans `Satisfied` and the instance is the one
      thing created.

- [x] **T117** One action gets a new user a website (D8, D9). The Quick Start card on the Dashboard,
      drawn only when `site.list` is empty, over the `ApplyDialog` that already renders a plan, the
      version questions and the scaffold consent. `mix blueprint apply --start` for parity. Both say
      the true thing about what "start" means — `service.start` with no target, *everything this
      home declares* — because deriving the apply's own service set in a client is business logic in
      a client, and would be wrong on the second apply anyway.
      **What this task settled.** The order is the whole of it, and it is the order the feature
      document already implied: apply → spend the elevation → start → open. A `PlanAction` that
      started services at the end of the job reads better and is unshippable, because an apply never
      raises a prompt — it queues what needs one — so a front end started inside the job would serve
      the new site at a name this machine does not resolve and with a certificate no store trusts,
      which is a browser error at the end of a progress bar. `mixengine_service_start_all` is its
      own command rather than `mixengine_service_action` with an empty id, because *one service* and
      *all of them* are two sentences and an empty id is where a typo becomes a machine-wide start.

## The affordances

- [x] **T118** PHP extensions get a screen, and the add-ons get their name back (D10). No API
      changes: `runtime.list_extensions` and `runtime.set_extension` have existed since T28 and
      `ExtensionsPanel` has rendered them since the Runtimes screen did. What was missing was a way
      to find them — four rows below a sidebar entry called *Extensions* that means something else
      entirely. The panel becomes a screen with a version selector, rendered in both places, and the
      add-ons screen's **label** becomes *Add-ons*. The screen id, the module, the `extension.*`
      methods and every document keep the word.
      **What this task settled.** The version the screen opens on is the home's **default** PHP and
      not the first installed one, because the default is the `php` a terminal in this home runs —
      somebody looking for *why is `redis` not loaded* is looking at that one. And a home with no
      PHP gets one sentence and a button to Runtimes rather than an empty table: an empty table
      makes a person guess which step they are missing.

- [x] **T119** The sidebar is grouped (D11). Five static headings — Overview, Websites, Environment,
      Library — with Settings pinned below them. Not collapsible: a section that collapses is a
      place for the thing somebody is looking for to hide, and its state is something to persist,
      migrate and get wrong.
      **What this task settled.** `GROUPS` is still the one place the order is decided, exactly as
      the flat `ITEMS` was — which is what kept this change out of `tabState.ts` for anything except
      the one new screen id. Settings sits at the bottom by being the one group with no heading, and
      `.group:last-child { margin-top: auto }` is the whole of it: a position rather than a special
      case in the table.

- [x] **T120** `{project}` expands to a slug, and a plan says so before an apply finds out
      ([ADR 0030](../decisions/0030-the-project-token-expands-to-a-slug.md)). Found by this phase's
      own Quick Start, which is the first place somebody who has never read a naming rule types a
      project name: `laravel 1` is a legal project name and is legal in none of the four name spaces
      T77 substituted it into — a database identifier, a DNS label, a `ServiceId` instance and a
      shell command. The token now expands to `domains::slug`, the handle `project.create` has
      derived a default domain with since T39a, and every expanded name is validated at plan time by
      the function that owns its name space.
      **What this task settled.** T77's D10 was a promise the code did not keep: the database step
      checked the account's *length* and the domain step checked only who held the name, so both
      planned green and failed mid-apply — after a directory had been made and three packages
      downloaded. The rule is enforced by its owner now, and `DATABASE_USER_LIMIT`, which restated
      `IDENTIFIER_LIMIT`'s number here, is gone. It also retired a comment that justified
      interpolating into a shell by asserting a project name "has already been through the slug
      charset"; it had not, and the assertion is true only now that what is substituted is the
      handle. An apply narrates each step into its job's log as well — until this task
      `LogSubject::Job` was written by the `[scaffold]` step alone, so a failure before it left a
      log a client could only render as blank — and the ring is dropped when the job ends, for every
      job nobody was reading.
      **What it deliberately did not do.** It did not tighten `projects::validated_name`: a project's
      name is a label a person reads, spaces have been legal in one since phase 0, and narrowing it
      would invalidate names already registered to fix a problem belonging to the four name spaces
      the token lands in. And it added no `database.drop`, so a database an apply made is still
      never taken back — the ledger names it instead.
      **The debt it leaves.** A job whose log somebody watched to the end keeps its ring: the drop
      is `forget_if_unwatched`, and a reader still connected is the one case it must not fire on.
      `services::logs` has the same shape for a service whose last reader disconnects after the
      runner has gone, so what closes it is one sweep over that shared surface rather than anything
      in `api::apply`.

- [x] **T121** An apply says what an unticked consent box means, and a finished apply ends at the
      site it made. Two halves of one complaint: a person applies a blueprint, watches it download
      a runtime, a database and a web server, and is left with an empty folder and no address —
      because the `[scaffold]` consent box went untouched and nothing said so, and because the
      chain that starts the services and opens the browser lived only in Quick Start.
      **What this task settled.** The desktop was behind `mix`, not missing an API: the CLI asks
      `Run it? [y/N]` and prints a line when nobody could be asked, while the dialog took silence
      for an answer. An unticked box now draws a warning beside itself and **renames the button** —
      *Set up without running the command* — because a button labelled `Apply` on a plan whose init
      command will not run is a button promising a project and delivering an empty directory; and
      the skipped step gets a block at the *top* of the Done screen, in the app's own words rather
      than the daemon's `why`, which ends in a `mix blueprint apply --run-scaffold` a person holding
      a mouse cannot use.
      The post-apply chain moved into `components/AfterApply`, which both callers now mount: grant
      first, then start, then say where the site is — in that order, because an address handed over
      before the elevation queue is spent is an unresolved name behind an untrusted certificate.
      **It hands over the address; it does not navigate.** The first build opened the browser itself
      whenever the init command had run, on the reasoning that a folder with code in it is the one
      case worth showing. Trying it settled the question the other way: the panel naming the address
      is already the thing that shows somebody their result, and pulling a browser window in front
      of them is a side effect they did not ask for. So the address is a button, and the click is
      theirs — which also retires the question of what to do about a finish whose folder is empty.
      **The ordering Quick Start now depends on, found by testing it.** Dashboard draws that card
      if and only if `site.list` is empty, so its `onCreated` is the read that makes the card
      *disappear* — and calling it when the apply finished, rather than when the whole chain did,
      unmounted `AfterApply` mid-flight every single time: Dashboard's one `site.list` returns in
      milliseconds while the chain is three calls deep, so it is not a race that sometimes loses.
      The symptom was a project built correctly, scaffold and all, and a browser that never opened.
      `onCreated` is called from `onFinished` alone, which is what the code this replaced did.
      **What it deliberately did not do.** It did not pre-tick the consent box — that is T78a's gate,
      and this task changes what is *said*, not what is allowed. It did not nest `AfterApply` inside
      `ApplyDialog`: both are `Modal`, `Modal` listens for Escape on `window`, and one press would
      close both. And it left the site's address a client-side read of `site.list`, the shape Quick
      Start already had.
      **The debt it leaves.** `BlueprintApplied` still does not carry the address of the site it
      made, so each client picks "the project's first site" for itself and `mix blueprint apply`
      prints no URL at all. A field on the proto would serve both and retire `siteUrl`'s guess.

- [x] **T122** A site may not name a service nothing answers to, and a pool that went missing is made
      again where the need is found. Reported from a real apply: `service.delete` took the
      `php-fpm@<version>` row while PHP stayed installed, and from that moment every php-fpm site
      creation on that home failed — with `(code: 787) FOREIGN KEY constraint failed`, at the end of
      an apply that had downloaded a runtime, created a database and started a web server.
      **What this task settled.** Two defects, one symptom. `core::sites` asserted *a site must name
      a service that exists* in `pool_is_free_for`'s own doc and enforced it nowhere: both
      `php_service_id` and `site_service_links.service_id` are foreign keys, so the write was never
      possible, but SQLite names neither the column nor the id and that sentence was what reached
      the user. `declared_services_exist` now refuses it by name, in `create` and in `update`, for
      `blueprint.apply`'s reason — it arrives at these rows without a CLI. And the invariant
      `services::pools::ensure` exists to hold was restored only at boot and after an install, so
      `service.delete` could break it for as long as the daemon stayed up: `sites::settled` derives
      `php-fpm@<version>` from `runtime_installs`, which `service.delete` does not touch, so
      `resolve` kept answering with a version whose pool was gone. The derived branch now runs that
      same idempotent repair when — and only when — the row is actually missing.
      **What it deliberately did not do.** It did not add a fifth refusal to `service.delete` for a
      runtime-origin pool. `services::pools`' own doc answers a row "deleted by hand" with repair
      rather than refusal, and reversing that is a cross-cutting decision that would need an ADR
      rather than an edit here.
      **The debt it leaves.** A failed apply still reports `could not take back: Site { … }: no site
      answers to <domain>` whenever the site step is what failed — `Ledger::attempting` writes the
      entry *before* the creation, so a creation that never happened is rolled back and cannot be.
      The line names a thing that was never made, which is the opposite of what the ledger is for.

- [x] **T123** A service nobody stopped is started by the request that needs it. Reported as *the
      php-fpm service is not ticked for autostart and the others are* — which is true, and ticking it
      would have been the wrong answer: `resource-isolation.md` says the front end is the only
      always-on service, and a pool is meant to be woken by its own traffic. What the missing tick
      revealed is that waking had been broken since T70 for every case but one.
      **The defect.** `services.idle_stopped` (T70, migration `0010`) is a boolean, written `1` only
      for `StateReason::Idle`. Everything else arriving at `stopped` — a row that has never run, a
      process that vanished with the machine, the daemon's own shutdown walk — landed on `0`, which
      the activator reads as *a person stopped this, do not undo it*. So a pool was wakeable only
      between an idle stop and the next restart, and a PHP site answered 502 after every reboot and
      every `mix daemon restart` until somebody ran `mix service start` by hand. M14 asks for the
      opposite in as many words: *the machine is restarted and the site is serving with nothing
      pressed*.
      **What this task settled.** Migration `0020` replaces the column with `stopped_by`, three
      answers — `never`, `person`, `daemon` — and `StoppedBy::may_be_woken` is the one sentence both
      readers ask, the web activator and the address holder. `NOT NULL` with a third word rather than
      `NULL` for "never", because `stopped_by != 'person'` is NULL and therefore *not true* for a
      NULL row: the query shape every reader wants would have silently skipped exactly the rows this
      task exists to wake. Upgrading reads `last_started_at` to tell a person's stop from a row that
      never ran, and leaves anything that ran and was stopped some other way as `person` — waking a
      service somebody deliberately stopped is the one mistake here that waiting does not undo.
      **And `daemon.shutdown` needed a word of its own.** It and `service.stop` walk the same
      `Registry::stop`, so both wrote `StateReason::Requested` and the row could not tell them apart
      — the very case a laptop meets most. `StateReason::Shutdown` is `StateReason::Autostart`'s
      mirror image and carries the same argument: somebody asked for the *daemon* to stop, which is
      not a sentence about any one service. `Registry::stop_because` is the stop half of the
      `start_because` the boot walk already had.
      **What it deliberately did not do.** It did not tick `autostart` on php-fpm pools, in
      `services::pools::ensure` or anywhere else. A user with four PHPs installed has not asked for
      four pools at every boot, and after this task the empty checkbox is the right answer rather
      than a gap. Nor did it touch D8: a stop somebody asked for is still one nothing may undo, and
      a dependent brought down by one still counts as theirs — waking it would start the service
      they stopped.

**Milestone M14** — on a fresh install, one button on the Dashboard and one elevation prompt produce
a browser open on a working `https://<name>.test`; the machine is restarted and the site is serving
with nothing pressed; a PHP extension is one click from the sidebar; and no two sidebar entries are
called the same thing.

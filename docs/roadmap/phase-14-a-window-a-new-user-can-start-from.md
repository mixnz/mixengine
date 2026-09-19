# Phase 14 — A window a new user can start from

*Goal: somebody who has just installed MixEngine gets a working website from one button, keeps it
after a reboot, and can find the settings they need without being told where they are.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-11-a-window-a-new-user-can-start-from-design.md](../specs/2026-09-11-a-window-a-new-user-can-start-from-design.md).

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
- [x] **T120a** A scaffold's directory is a name too, and its output is not a terminal. T120 counted
      the four name spaces `{project}` is *substituted into*; the **directory** is a fifth the token
      never reaches, because a client composes it instead. `npx create-next-app .` takes its package
      name from that directory's basename and npm refuses capitals and spaces, so `nextjs` failed for
      every project named the way people name things — at the last step, over a directory it had just
      made. Measured rather than reasoned about: `Next.js 1` exits 1 and leaves the directory empty,
      `next-js-1` succeeds, and `create-next-app` has no name flag to sidestep either with.
      **The naming moved rather than being copied**, which is the whole of the design. `mix` may not
      depend on `mixengine-core` and `domains::slug` may not move to `mixengine-proto` — that crate's
      note reserves the question — so the first draft's "compose it in the CLI" would have meant a
      second copy of the charset T120 spent a task consolidating, reachable only through `home.rs`'s
      duplication escape hatch. The request gained `root_is_parent` instead: a client sends where it
      is standing, the daemon composes at the one choke point both plannings pass through, and the
      desktop's written refusal to hold a naming rule is kept exactly as it was. A path somebody
      typed is still used as spelled.
      **And what a command prints is data.** Its output reached a person as `[31m…[39m` and would
      have reached a terminal as instructions; escapes are removed at capture, so the job log, the
      stream and the failure sentence are covered once rather than by three renderers remembering.
      T120's own security note had reasoned about exactly this hazard and closed it — for the
      project's *name*, which `validated_name` guards, and silently not for the command's output.
      `NO_COLOR` is set as a complement and never as the guarantee: measured, `FORCE_COLOR=0` does
      nothing here.
      Design: [2026-09-13-t120a-a-scaffolds-directory-is-a-name-too-design.md](../specs/2026-09-13-t120a-a-scaffolds-directory-is-a-name-too-design.md).

- [x] **T120c** A folder somebody chose is the folder, and a scaffold says what it needs of one.
      T120a's fix reached `mix` and Quick Start and left the door labelled *Blueprints* exactly as
      it was — that dialog's root box is required, so every apply from it is by T120a's own
      definition "a path somebody typed", and `nextjs` went on failing there.
      **T120b was built, measured working, and thrown away.** It put a checkbox on the dialog
      defaulting to *make a folder inside the one you chose*. It worked, and it answered the wrong
      question: somebody who picks a folder wants **that** folder to hold the source, and the person
      who insists on theirs still meets npm's own sentence, understands nothing, and stops using the
      product. **A default can make a bad outcome rarer; only an explanation makes it survivable** —
      that sentence is the whole of this task, and it is what turned a defaults problem into a
      comprehension one. The one line kept from T120b is `white-space: pre-wrap`, without which
      T120a's line breaks collapsed and the two npm rules read as one run-on sentence.
      So the folder is honoured everywhere and the refusal moved forward instead: `[scaffold]`
      gained `needs_npm_safe_dir`, declared like `needs_empty_dir` and never inferred from the
      command, and the plan `blocked`s the step before a byte is downloaded, naming what to rename
      the folder to. No new plan concept, no wire field, no client control — every client already
      renders a blocked step.
      **The ruler nearly chosen was `domains::slug`, and the row that killed it is `next_js_1`**:
      `slug` turns every character outside `a-z0-9` into a hyphen, underscore included, so it would
      have refused a directory `create-next-app` accepts and installs into — measured, along with
      the six other names in the design's table. A DNS label and a package name are different rules.
      `slug` kept the other job: it always answers in a charset the rule accepts, so it is what the
      refusal *suggests*. **Under-blocking is the safe direction** and the rule is written for it —
      a false refusal forbids a thing that would have worked with no way round, a miss costs one
      install and falls back to the failure's own words, which now name the folder too, for every
      imported blueprint whose author will never declare the flag — but only when the command is one
      of the npm family, because the first cut said it after *any* failed scaffold and a `composer`
      that died over a network would have told somebody their folder was the problem. That is this
      task's own mistake pointed back at itself, and it is the one place a guess about the command
      is allowed: it may add a hint after a failure, never refuse anybody up front.
      Design: [2026-09-13-t120c-a-folder-somebody-chose-is-the-folder-design.md](../specs/2026-09-13-t120c-a-folder-somebody-chose-is-the-folder-design.md).

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

- [x] **T124** A site with nothing behind it says so, instead of answering 404 or 502. Design:
      [docs/specs/2026-09-13-t124-a-site-with-nothing-behind-it-says-so-design.md](../specs/2026-09-13-t124-a-site-with-nothing-behind-it-says-so-design.md);
      ADR [0031](../decisions/0031-a-site-with-nothing-behind-it-is-answered-by-mixengine.md).
      **What this task settled.** A welcome page is a `Document` like any other — `welcome/<primary>.html`
      beside the site's own configuration, swept by the same pass — so nothing is written into a
      project directory and the page goes away by itself the moment the site answers. The condition
      is a matcher's and never an ordering's: `handle` blocks are mutually exclusive only among
      themselves, so a route placed after `php_fastcgi` or `file_server` is not reliably reached, and
      Caddy's `not file` is what carries the whole question. The proxy kinds are answered on 502 and
      504 at every path, because a gateway error the front end produced means nothing was listening
      and there is no application answer to overwrite — while an upstream's *own* 502 passes through,
      which is why nginx renders `error_page` and never `proxy_intercept_errors`.
      **What it got wrong on the way.** Its nginx rendering for the php-fpm kind named `/index.php`
      in a `try_files` inside a location with no `fastcgi_pass`, which serves that file in place —
      a site's own source, as text, on its own home page. **T124a** is what found and replaced it.
- [x] **T124a** The welcome page reaches a php-fpm site on nginx, through the index module rather
      than through `try_files`. **What this task settled.** nginx has no `not file` matcher, so the
      question "is there an index here" cannot be asked the way Caddy asks it; the index module
      answers it as a side effect, because it makes an *internal redirect* when it finds a file —
      `/index.php` is re-matched by `location ~ \.php$` and runs as PHP — and reports 403 (or 404
      for a document root that does not exist yet) when it finds nothing. `error_page 403 404` in
      an exact-match location on `/` is therefore reached only in the case this page is for, and an
      application's own status, at this path or any other, is never what is replaced. **And `alias`
      may not appear in a named location**: nginx refuses the whole configuration over it, so one
      page's mistake would have taken every site on the machine down — measured, and the welcome
      location uses `root` with `try_files` instead.
      **What it also did.** `welcome.rs` became one sequence driven through both front ends, and
      `NGINX` moved from `tests/nginx.rs` into the shared harness to make that possible: a claim
      about what a site answers is a claim about both servers, and the rendering that had to be
      written twice is the one a Caddy-only suite would never have served.

- [x] **T125** A start after an apply is the project's services, and a failed step does not say
      "ready". Reported from a real apply: applying one blueprint started **every service this home
      declares**, and a `[scaffold]` that exited non-zero still ended at a panel offering to open
      the website.
      **What this task settled.** Both halves were one omission — `ServiceTarget` could name one
      service or none, and *none* meant the whole home, so both clients asked for the whole home
      because the set they wanted had no question to ask for. It now takes a `project`, answered by
      `core::sites::services_of` (the sites' `site_service_links` plus the php-fpm pool a kind
      names) and the home's front end, which is not a service any site declares and is the one
      thing nothing wakes on demand. T117's reasoning stands and its conclusion does not: deriving
      the set in a client is still business logic in a client — so the daemon derives it.
      **Front-end-only was measured and rejected**: `resource-isolation.md` promises a database is
      woken by the connection that needs it, but `hold::hold_if_wakeable` binds at the boot walk and
      on an idle stop, so an instance this apply has just created is wakeable at nothing until the
      next daemon start. A start scoped to the front end alone would put a site up in front of a
      database its own application cannot reach.
      **A project has no `stop`**, and the refusal is the type's own doc rather than a gap: the set
      includes the front end every *other* site is reached through, so a project-scoped stop is a
      machine-wide outage wearing one project's name. A request naming both a service and a project
      is refused for its own reason — resolving two subjects by precedence carries out the half
      nobody meant.
      **And "the job succeeded" is not "the apply is fine."** `api::apply` deliberately answers a
      non-zero `[scaffold]` with `StepResult::Failed` inside a *successful* job, because a project
      whose site serves and whose database exists is not worth destroying over a post-install
      script; `mix` has read that as an exit code since T78a and the desktop had not read it at all.
      `AfterApply` takes the whole `BlueprintApplied` now: the chain still runs — the elevation
      queue is still worth spending and the front end is still worth starting — but the failed steps
      are named at the top, the heading says so, and the address is a line of text instead of a
      button inviting somebody into a half-built directory.
      **What it deliberately did not do.** It did not make a failed step abort the post-apply chain
      the way `mix` aborts: `mix` stops because it owes a shell an exit code and cannot both exit
      non-zero and carry on, while a window that stopped there would leave a queued hosts entry and
      a stopped web server behind as a protest against somebody else's script. And it did not
      pre-arm `hold_if_wakeable` at `service.create`, which would make a front-end-only start
      correct — that is a change to when the daemon binds addresses, not to what a client may ask.

- [x] **T126** A credential's address names the home it belongs to, and a server that refuses one
      says what that means. ADR
      [0032](../decisions/0032-a-keyring-address-names-the-home-it-belongs-to.md).
      **Reported as an apply that would not finish**, and it was not the apply: the database step of
      a Laravel blueprint failed with `ERROR 1045 (28000): Access denied for user
      'root'@'127.0.0.1'` against a server that had been serving that home's databases for a day.
      **What this task settled.** The credential store is one per operating-system *user* and
      `MIXENGINE_HOME` means a user has several homes, but an address said only
      `<service-id>/<user>` — so every home on a machine shared one entry, and the last to bootstrap
      a `mariadb@main` took the root password of every server already running under that name. A
      database is where that is fatal rather than untidy: the bootstrap writes the password into the
      server's data directory as well, only a first run writes both, and nothing can read one back
      out. Found by timestamp — a sandbox home's first run at 05:55:57 and the entry's last-written
      time at 05:55:57 — and reproduced outside MixEngine by reading the entry and handing it to
      `mariadb.exe`. It took `mix service stop` down with it: the shutdown command authenticates as
      root too, so the supervisor could only kill the server.
      **The id is the home's, not its path's.** `0021_home_id.sql` mints six random bytes at the
      first migration; a hash of the root path needs no row and strands every credential the moment
      somebody renames the directory, which is this outage arriving by another route — and on
      Windows, case, 8.3 names and UNC spellings are four hashes for one directory.
      **An older entry is moved on the read that needs it**, in `mixengined`'s new `secrets` module,
      because there is no set to walk: a ritual's credentials are enumerable from the recipes and a
      database *account's* are not — the names arrive from whoever asks, and only the server knows
      them all. The old entry is left in place, since another home may still be running a build that
      reads it.
      **And the failure explains itself now.** A superuser refusal — `1045` for the MySQL family,
      `28P01` for PostgreSQL, matched on the server's own code rather than on prose — is answered
      with what it means and with the two ways out, instead of with the client's own line at the end
      of a blueprint that had already downloaded a runtime and made a directory.
      **What it deliberately did not do.** It did not delete the pre-T126 entries, and it did not
      automate the repair: a server whose password was already replaced has to be re-set against its
      own data directory through the recipe's bootstrap, which is **T127** and wants a job, a log
      and a branch per recipe rather than a line here. It did not change `SecretAddress` either —
      the shape moved, the type did not, because every client reads the address the daemon returns.

- [x] **T127** A credential a home cannot produce any more is re-set by a command rather than by
      hand. `mix service reset-credential <service>`, and the design is
      [docs/specs/2026-09-13-t127-a-credential-a-home-cannot-produce-is-re-set-by-a-command-design.md](../specs/2026-09-13-t127-a-credential-a-home-cannot-produce-is-re-set-by-a-command-design.md).
      **What this task settled.** Every recipe already owned its own repair and none of them knew
      it: a ritual is *create the data directory, then set the password through a server that
      listens on nothing*, and a repair is the second half alone. So `Ritual` grew a third field
      naming that step for re-use, `FirstRun` exposes it, and the three recipes fill it with
      functions they already had. That those steps run against a directory that is **already full**
      was measured rather than assumed, on Windows, against 11.4.12 / 17.11 / 8.0.44, each on a
      directory that had been *killed* rather than shut down — which is the only stop this repair
      can have, since the shutdown command is the thing that cannot authenticate. MariaDB's
      `--bootstrap` took 0.36 s and kept every database; the risk was real, because
      `mariadb-install-db` refuses a non-empty directory and it was reasonable to expect the server
      to as well.
      **`postgres --single` performs its own crash recovery** — *"database system was not properly
      shut down; automatic recovery in progress"*, then redo, then the `ALTER ROLE` — and tolerates
      a stale `postmaster.pid`. Nothing has to clean up after the kill before the repair can run.
      **`mysqld.exe` forks a child on Windows**, and a child that outlives its parent holds the data
      directory and answers `The innodb_system data file 'ibdata1' must be writable` — a sentence
      about a live process wearing the words of a file permission. That is why the job proves the
      directory is writable before it runs a step, and says what it means when it cannot.
      **A new `StateReason` does not become unwakeable by existing.** The reset stops the service so
      that nothing starts a server against a directory a step is writing into, and what decides that
      is `StoppedBy::may_be_woken` in another crate — whose `of` reaches the *wakeable* answer
      through a `_` arm. A word added to the protocol and named nowhere else compiles cleanly and
      produces exactly the hazard it was added to prevent, so the test is aimed at `may_be_woken()`
      rather than at the word.
      **And T126's PostgreSQL hint had never fired.** It matched the literal `28P01`; psql never
      prints it for a refused login — not with the recipe's own arguments and not with
      `VERBOSITY=verbose` — because that is a libpq *connection* failure and never reaches the
      formatter that would print a SQLSTATE. The matcher takes libpq's own sentence now, and both
      hints name the command.
      **What it deliberately did not do.** No `mix doctor` check: detecting this means authenticating
      against every running database on every run, and the repair is a multi-minute job with a log
      where `doctor_repair` is shaped for a short synchronous act. No `--rotate`, although the
      measurement says it would be safe — nothing outside the keyring keeps a copy of that password,
      and a repair still changes as little as it can. No desktop button. And it did not delete the
      pre-T126 keyring entries T126 left behind, which is still its own task.
      **What it found and left open — T127a.** A PostgreSQL user does not see the sentence that names
      this repair, and the reason is the ready check rather than the matcher above. This cluster's is
      an authenticated query, so a password it does not have takes the service from `starting` to
      `failed reason=ReadyTimeout` and the user is told *"did not start — not ready within 2m"*;
      MariaDB's is `mariadb-admin ping`, which answers before authentication, so the service reaches
      `running` and the provisioning probe is where the refusal is met and explained. Measured in
      `crates/mixengine-cli/tests/postgres.rs`, which asserts the symptom rather than wishing it
      away. Making the *start* path say what a refused superuser means is the task this leaves.

- [x] **T127a** A database that cannot start because its superuser password is wrong says so, rather
      than reporting a ready check that timed out. `StateReason::SuperuserRefused`, and the design is
      [docs/specs/2026-09-13-t127a-a-refused-superuser-is-named-by-the-start-that-failed-design.md](../specs/2026-09-13-t127a-a-refused-superuser-is-named-by-the-start-that-failed-design.md).
      **What this task settled.** The reading happens *after* the start has failed and never while
      one is running — T38's shape exactly, where the daemon asks the OS who holds the port before it
      settles on a reason. The obvious alternative was to race the log against `ready::wait` and
      abort the moment a refusal is printed, turning two minutes into two seconds; it was rejected
      on what an abort would be acting on. During `starting`, MixEngine's ready check is not the only
      thing that server can refuse — an application, a `pgAdmin` left polling, a second home — and a
      reader that only *renames a failure that already happened* cannot be wrong about anything but
      the wording, where one that kills a starting cluster on a single log line takes down a start
      that was going to succeed. So the wait is unchanged and the sentence at the end of it is not.
      **Two guards, and the second is the one that makes a log safe to act on.** The line must come
      from a service that has a database vocabulary — the map T77a already fills, so a php-fpm pool
      whose worker printed `Access denied for user …` is never diagnosed as a pool with a wrong
      superuser password, which would also offer it a repair that answers `Unsupported`. And it must
      name *this instance's* superuser, which is why `Provisioning` grew `root_user`:
      `password authentication failed for user "shop"` is an application's problem and stays a ready
      timeout. What remains — somebody connecting *as* the superuser with a stale password while a
      start was failing for another reason — is a credential that really has come apart, so the
      sentence is not even wrong.
      **One vocabulary, two readers.** T126's three refusal sentences moved to module scope in
      `services::databases` beside a `repair_hint` extracted from the same function: the provisioning
      probe reads the *message of a statement MixEngine ran*, and the new matcher reads *lines a
      server wrote to whoever was talking to it*. A second copy of those strings is the thing that
      would go stale the next time a client changes its wording — and both of them lost the runs of
      spaces they had been carrying into a user's terminal since T126.
      **A port conflict still outranks a refusal.** If another program holds 5432 the client this
      check runs is talking to *that* program, so a refusal it printed is not this cluster's.
      **What it deliberately did not do.** No early abort, above. No change to `ready::wait`,
      `ReadyCheck` or the supervisor crate at all — reading the *probe's* own stderr would need
      none of the second guard, because that refusal is certainly ours, but it means a new shape in
      a public API reaching every ready check to serve one recipe, and it works for `Command` checks
      alone where reading a service's log works for any of them. No `mix doctor` check and no
      automatic repair, both for T127's reasons. And no desktop affordance: nothing in
      `apps/desktop/src` reads `StateReason` yet.
      **What it found.** `features/services.md` claimed *"the readiness check of all three of these
      recipes is an authenticated query"*. Two of them are; MariaDB's `mariadb-admin ping` answers
      before authentication, which is the asymmetry this whole task exists for — so a MariaDB reset
      that ends with the server running has proved the server starts, and the credential is proved by
      the next statement run against it. The sentence is corrected; the repair is unchanged.

- [x] **T128** A plan names the project the way the row will spell it. Found in the daemon log of
      the failed apply T126 was reported from: `a failed apply could not take back what it made
      made=Project { name: "Laravel " } error=no such project: Laravel `. The rollback was looking
      for a project under a name nothing had ever been stored under.
      **What this task settled.** `projects::validated_name` trims — it has since phase 0, and
      `project.create` stores what it returns — while `blueprints::plan` carried the string the
      request arrived with and handed it to three readers that each compare by equality. So one
      trailing space made three different failures, all of them after the work had begun: the
      resumption check in `register` found neither the project nor a name collision and planned a
      `Create` that the root check then **blocked over this apply's own first attempt**;
      `ProjectRef::Name(plan.project)` could not find the row the `[site]` step hangs off; and the
      ledger recorded a project under a name `projects::find` cannot match. The plan now trims once,
      before anything reads the name — T120's rule arriving at the project's own name rather than at
      the four name spaces `{project}` is substituted into.
      **A name that is not one is still left exactly as it arrived**, because `register` is what
      says so, as a `Blocked` step naming the reason. That is `plan`'s contract and this task did not
      touch it: everything a person did wrong is a step they can read rather than an error that
      prints no plan at all.
      **What it deliberately did not do.** It did not make `projects::find` lenient. A name is
      normalised where it is *created*, and a lookup that quietly trimmed what somebody typed would
      be a second rule about what a name is — the one this task exists to remove. `mix project show
      "Laravel "` still finds nothing, and that is an honest answer about a project called
      `Laravel`.

- [x] **T129** Autostart is a switch on the row it belongs to, and an apply stops deciding it. The
      Dashboard's ⋮ menu carries *Turn on / Turn off autostart* over `service.set_autostart`, which
      is also what un-greys that button: every service has an entry now, not only a database. And
      Quick Start stops sending `BlueprintApply.autostart`, so an apply from the card and one from
      Blueprints leave the same machine behind — T116's flag and `mix blueprint apply --autostart`
      are untouched; what changed is that the window stopped answering a question nobody asked.
      **What it leaves.** M14's *the machine is restarted and the site is serving with nothing
      pressed* now needs one tick on the front end: the boot walk starts flagged roots only, and the
      web activator lives inside the front end's own config, so nothing answers port 80 on a home
      nobody ticked it for.

**Milestone M14** — on a fresh install, one button on the Dashboard and one elevation prompt produce
a browser open on a working `https://<name>.test`; the machine is restarted and the site is serving
with nothing pressed; a PHP extension is one click from the sidebar; and no two sidebar entries are
called the same thing.

**The second clause is not met today, and T129 is why.** Nothing ticks the front end's `autostart`
— not `service.create`, not an apply that was not asked — so a fresh install serves until the
machine is restarted and then serves nothing, one tick away either way. The clause stands as
written; what would close it is a default decided from the recipe's role where the row is written,
which is a daemon change and a reversal of T116's default, so it needs a task and an ADR rather than
an edit here.

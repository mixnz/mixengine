# T120a — a scaffold's directory is a name too, and its output is not a terminal

**Date:** 2026-09-13
**Status:** accepted
**Roadmap:** phase 14, task **T120a** — the fifth name space
[T120](2026-09-12-t120-the-project-token-expands-to-a-slug-design.md) did not count, plus a defect
in **T78b**'s command capture. Found by applying `nextjs` from the desktop application.

## What was observed, and how

Applying the `nextjs` blueprint to a project called `Next.js 1` fails at the last step, leaving the
project directory empty, with this on screen:

```
Chạy: npx --yes create-next-app@latest . --yes

Thất bại — `npx --yes create-next-app@latest . --yes` exited with 1 — its last words: Could not
create a project called [31m"Next.js 1"[39m because of npm naming restrictions: / [31m[1m*[22m[39m
name can only contain URL-friendly characters / [31m[1m*[22m[39m name can no longer contain capital
letters
```

Every claim below was measured on this machine on 2026-09-13 — node v24.19.0, npm 11.17.0,
`create-next-app@latest` — rather than reasoned about.

### 1. The directory is an input to somebody else's program

`create-next-app` has **no `--name` flag**; its `--help` offers `create-next-app [directory]` and
nothing else. The gallery's command passes `.`, so the package name is the **basename of the
directory the command runs in**, validated against npm's rules: lower case, URL-friendly.

```
mkdir "Next.js 1" && cd "Next.js 1" && npx create-next-app@latest . --yes  →  exit 1, directory empty
mkdir "next-js-1" && cd "next-js-1" && npx create-next-app@latest . --yes  →  Success!
```

That directory is MixEngine's doing. `mix blueprint apply --path` documents its default as
`<current directory>/<project>` and computes it at
[`crates/mixengine-cli/src/main.rs:3783`](../../../crates/mixengine-cli/src/main.rs) as
`here(None)?.join(&project)` — the project's **name**, untouched.

Meanwhile the same string is slugged for everything else. T120 made `{project}` expand to
`domains::slug` ([`plan.rs:134`](../../../crates/mixengine-core/src/blueprints/plan.rs)), and
[ADR 0030](../../../.claude/decisions/0030-the-project-token-expands-to-a-slug.md) settled the rule
as *one project, one human name, one machine handle*. So:

| `Next.js 1` reaches | Through | As |
|---|---|---|
| the domain | `domains::slug` | `next-js-1.test` ✅ |
| the database, the account, a `per-project` instance | `domains::slug` | `next-js-1` ✅ |
| **the directory** | `join(&project)` | **`Next.js 1`** ❌ |

T120 counted four name spaces because it counted the ones `{project}` is substituted into. The
directory is a fifth, and the token never lands there — it is composed by the client instead, which
is why the audit missed it.

### 2. Only `nextjs` is hit, and it is hit by most ordinary names

Four gallery blueprints carry a command. Three are `composer create-project … .`, which takes its
package identity from the argument and not from the directory. Only `npx create-next-app . ` derives
a name from where it is standing.

But it is hit by **any** name with a capital or a space — `My Blog`, `Shop v2`, `Next.js 1` — which
is how people name things. A blueprint that works only for names that are already slugs is a
blueprint that works for the people who did not need the gallery.

### 3. The failure sentence is unreadable, and the repository already knows why

`environment()` ([`scaffold.rs:107`](../../../crates/mixengine-daemon/src/api/apply/scaffold.rs))
states that it **invents no environment**: it sets `PATH` and `MIXENGINE_HOME` and stops. Nothing
tells the child there is no terminal, and nothing scrubs what comes back. `create-next-app` colours
a pipe regardless, so the escape sequences survive into an error string a GUI renders as text.

```
(no setting)     →  Could not create a project called ^[[31m"Next.js 1"^[[39m …
NO_COLOR=1       →  Could not create a project called "Next.js 1" …
FORCE_COLOR=0    →  Could not create a project called ^[[31m"Next.js 1"^[[39m …
```

`FORCE_COLOR=0` — the obvious guess — does nothing here. That is the reason D5 below refuses to rest
on it.

**The rule already exists in this daemon and is applied to one side only.**
[`logging/mod.rs:375`](../../../crates/mixengine-daemon/src/logging/mod.rs) asserts
`!written.contains('\u{1b}')`: what this daemon writes carries no escape. What this daemon *captures
and re-emits* is not covered. T120's own security note says the narration is safe because
*"`projects::validated_name` already refuses control characters, so no ANSI escape can reach it"* —
true of the project's name, and silent about the command's output, which is the other half of the
same log.

Separately, `failure()` ([`scaffold.rs:316`](../../../crates/mixengine-daemon/src/api/apply/scaffold.rs))
joins the last lines with `" / "`. The stray slashes in the report above are that, not paths.

### 4. What is not broken

The empty directory is the design working. *The files were never ours*
([ADR 0031](../../../.claude/decisions/0031-a-site-with-nothing-behind-it-is-answered-by-mixengine.md)),
and `nextjs` is a `node-app`, so a browser pointed at the site gets **T124's welcome page** off the
502 rather than a dead tab. Nothing here changes that, and nothing here needs to.

## Goal

A person who names a project the way people name things gets a working Next.js site; and when a
scaffold does fail, the sentence explaining why is one a person can read.

## Scope

**In**

- The directory `mix blueprint apply` chooses when nobody chose one.
- The folder Quick Start proposes (D3 — severable, see below).
- Escape sequences in a scaffold's captured output, wherever that output is shown.
- The shape of a failed command's last words.

**Out**

- `projects::validated_name`. T120 refused to narrow it and the reason stands: a project name is a
  label a person reads, `project.create` has accepted spaces since phase 0, and names already exist
  in people's databases.
- Renaming an existing project's directory. Not ours to move.
- Stripping escapes from **service** logs. Different population, different question — see the
  self-critique.
- A manifest field declaring what a scaffold needs of its directory. It is a format change to a
  **signed** file, dragging `publish-blueprints` and a re-signing round behind it, to say one step
  earlier a thing D4 makes legible and D1 makes rare.
- Moving `domains::slug` into `mixengine-proto`. That crate's own note reserves the question for
  `mixengine_core::domains`; reversing it would need an ADR, and D1 removes the reason to want it.

## Decisions

### D1 — The client says where it is standing; the daemon names the directory

`mix blueprint apply --project "Next.js 1"` with no `--path` produces
`<current directory>/next-js-1`. ADR 0030's rule reaches the one consumer the token never touched,
and the whole apply becomes consistent: the domain `next-js-1.test`, the database `next-js-1`, and
now the directory `next-js-1`.

**The composition happens in the daemon, not in the client**, and that is the whole of this
decision. `BlueprintApply` gains one field:

```rust
/// Whether `root` is the project's directory or the place to make one in.
///
/// `false` — the default, and what an explicit path means — takes `root` exactly as spelled.
/// `true` says *make one under here*, and the daemon names it with the project's handle
/// (`domains::slug`, ADR 0030), because that rule is the daemon's and a client may not hold a
/// second copy of it.
#[serde(default)]
pub root_is_parent: bool,
```

| Sent by | `root` | `root_is_parent` |
|---|---|---|
| `mix blueprint apply` with no `--path` | the current directory | `true` |
| `mix blueprint apply --path X` | `X` | `false` |
| Quick Start | the folder the person browsed to | `true` |
| `ApplyDialog`'s own root box | what is typed in it | `false` |

**The first draft of this spec put the join in the CLI, and it was wrong.** `mixengine-cli` may not
depend on `mixengine-core` (`mixengine-proto/tests/workspace_layering.rs`), so it cannot call
`domains::slug`; and `slug` may not move to `mixengine-proto`, whose module note reserves exactly
this — *"Syntax lives here; policy does not … what a project's name slugs to … stays in
`mixengine_core::domains`"*. The available workaround was `home.rs`'s sanctioned duplication — a
second copy of the rule with a test holding the two together — which is precisely the fragmentation
T120 spent a task undoing. Splitting the question along the layer that already exists costs one
field instead: **the client knows where it is, the daemon knows what things are called.**

Nothing is silently renamed, and nothing new is needed to prevent it: the composed root is what the
daemon returns in `PlanAction::RegisterProject { root }`, which both clients already render before
anything is created — `blueprintPlan.ts:109` for the desktop, the printed plan and `--dry-run` for
the CLI.

### D2 — A path somebody typed is obeyed exactly

`--path "C:\Work\Next.js 1"` creates that directory, with its capitals and its space. MixEngine
chooses only when nobody has chosen; a folder a person named is a folder a person named, and
silently re-spelling it would be worse than the failure this fixes.

The consequence is deliberate: that apply still fails at the scaffold. It fails with a sentence that
can be read (D4), against a site that already answers (T124), and after a plan that showed the root
before anything ran.

### D3 — Quick Start's folder is the place to make the project, not the project

`QuickStart.tsx` asks the person to browse to a folder and sends it as the project root exactly. It
now sends that folder with `root_is_parent: true`, and the daemon names the directory under it.

It is the right interaction independently of this defect: every blueprint with
`needs_empty_dir = true` refuses a folder that has anything in it, so "browse to the folder itself"
asks somebody who has never used the product to create an empty directory by hand before the button
will work.

**No naming rule reaches the TypeScript.** `quickStart.ts` already refuses to hold one — *"not a copy
of the daemon's slug rule; the daemon is still the place that refuses, and this card must not guess
for it"* — and that position is kept exactly. The composed path is not guessed at, it is read off
the plan the dialog already renders before Apply.

The label for the field changes, in both `i18n/en.ts` and `i18n/vi.ts`, because "Folder" now means
the folder it goes *in*.

### D4 — A scaffold's captured lines carry no escape sequences

Escapes are removed where the lines enter the sink in `scaffold.rs` — covering both the drained
stream and the `already_said` backlog — so that the job log T120's D5/D6 built, the event stream and
the failure sentence are all clean from one change rather than three.

Removed at **capture**, not at display: there are three renderers today (the CLI, the desktop
dialog, the job log) and a rule enforced in one place is a rule, while a rule enforced in three is a
schedule for the fourth to be written without it.

### D5 — `NO_COLOR=1` is set, and nothing depends on it

`environment()` gains it. `whole_environment`
([`platform/src/process.rs:732`](../../../crates/mixengine-platform/src/process.rs)) clears and
rebuilds from an allowlist plus the caller's map, so this is one entry and no inheritance question.

This bends `environment()`'s "invents no environment" note, and the note should be amended rather
than quietly broken. The argument: `NO_COLOR` does not change what a program does, it states a fact
about where the output is going — a pipe, with no terminal on the other end. The daemon is not
choosing the child's behaviour, it is answering a question the child would otherwise guess wrong.

It is a **complement to D4 and never a substitute**: it is a convention, honoured by
`create-next-app` and not by every program, and D4 is what makes the guarantee.

### D6 — A failure's last words keep their line breaks

`failure()` joins with a newline. Multi-line output from a build tool is the normal case, and the
current `" / "` turns a three-line explanation into one line with punctuation that looks like paths.

### D7 — One field, added rather than changed

`BlueprintApply.root` keeps its type and its meaning. `root_is_parent` is added with
`#[serde(default)]`, so `false` is what every request that does not mention it means — which is what
every client sends today, and what an explicit path will go on sending.

It is a contract change all the same: `bash packaging/bindings.sh` regenerates `bindings/`, the
`bindings` CI job fails if the committed output differs, and the desktop passes the new field.
`PlanAction::RegisterProject` is untouched — it already carries the composed root, which is how the
person sees it.

## Self-critique

**Two names, one handle, one directory.** `My Blog` and `my-blog` both default to `./my-blog`. The
second apply does not overwrite anything: `register` refuses with `ProjectRootTaken` naming the
project already there, or `occupied(root)` refuses a `needs_empty_dir` command. Both are refusals
that name what is in the way, which is the same position `domains::default_for` takes about
colliding domains — *"a collision is not this function's business"*. Inventing `my-blog-2` would
hand somebody a directory they never typed and will not find later.

**A name with nothing to slug.** `domains::slug` returns `None` for a name with no ASCII in it at
all. With `root_is_parent`, the daemon has no directory to compose and blocks the step at plan time,
naming the reason and saying that a path given outright is accepted — T120's D3 position (blocked
where the handle is used, and nowhere else) applied to the fifth name space. It is not a loss
either: such a name could never have produced a legal npm package name.

**Why not duplicate `slug` into the CLI.** `home.rs` does exactly that for `RUN` and the home root,
with a test starting a real daemon and a real client to prove the two still agree, so the pattern is
sanctioned and the ban's stated reason is binary cost — `core` carries `sqlx` — rather than purity.
It is still the wrong trade here. Those two answers are *layout constants*; a slug is a naming
**policy** that T120 spent a task consolidating, and a second copy would be a second place for it to
drift the moment anybody touches the charset. One additive field buys the same result with no copy.

**Backward compatibility.** This is the one visible behaviour change in the task. A script running
`mix blueprint apply --project "My Blog"` with no `--path` used to create `./My Blog` and will
create `./my-blog`. It cannot damage an existing project — the new path is a different directory, so
the worst case is an apply that registers a new project beside the old one rather than resuming it.
The root is printed in the plan before anything runs, and `--dry-run` shows it. A person who wants
the old directory has always been able to name it, and after D2 naming it works.

**Why not strip escapes in `Capture` for everything.** That is the broader fix and it is tempting,
because "a log holds no escapes" reads like a daemon-wide rule. It is out of scope here for a reason
worth writing down: well-behaved long-running servers do not colour a pipe, so the population that
actually emits escapes is the npm ecosystem, and the npm ecosystem reaches this daemon through
`[scaffold]` and nowhere else. Widening the change would put every service's log bytes under a new
transformation to fix a problem none of them have. If a service is later found colouring a pipe, the
rule moves down a layer and this decision is the note explaining why it had not yet.

**Security.** D4 removes an injection path rather than escaping one, which is this codebase's
standing preference. The output of a program a person consented to run is currently written
uninspected into a string the CLI prints to a terminal; escape sequences there can move the cursor,
recolour a session, or overwrite the line above. T120 reasoned about exactly this hazard and
concluded it was closed, because the only untrusted string it was looking at was the project's name.
The command's own output was never in that argument. D1 and D2 change no privilege: the directory a
command runs in is chosen before it runs, and a person naming it explicitly is already the person
who consented to the command.

**Performance.** One `slug()` call over a ≤64-character string, once per apply. One scan per
captured line, over a ring bounded at 200 lines, for a job that is downloading a runtime.

**What could still be wrong.** That `composer create-project … .` ignores the directory's name is
read off how the command is shaped rather than measured — composer takes the package from its
argument. The acceptance below measures it rather than leaving it asserted.

## Acceptance

1. `mix blueprint apply nextjs --project "Next.js 1"` with no `--path`, on a machine with node 24,
   creates `./next-js-1`, runs the scaffold to completion, and leaves a Next.js project.
2. The same with `--path "<dir>/Next.js 1"` fails at the scaffold, and the failure text contains no
   `\u{1b}`, keeps its line breaks, and still names the npm rule that refused it.
3. A unit test on `failure()`: escape sequences in the captured lines never reach the returned
   string; a three-line input comes back as three lines.
4. A test that `environment()` carries `NO_COLOR`.
5. `mix blueprint apply laravel --project "My Blog"` (composer, not npm) still scaffolds — the
   measurement that bounds the blast radius to `nextjs`.
6. `--dry-run` prints the composed root, so the directory is visible before anything is created.
7. A name with nothing to slug, sent with `root_is_parent`, is a **blocked plan step** naming the
   reason — not a failed apply, and not a directory.
8. A request that omits `root_is_parent` entirely is applied at the root it names, byte for byte as
   before: the serde default is the old behaviour.
9. `grep` finds no slug charset in `crates/mixengine-cli/` or in `apps/desktop/src/` — the rule stays
   in one place, which is the point of D1.
10. `bash packaging/bindings.sh` leaves the tree clean, so the `bindings` CI job passes.

## Files

- `crates/mixengine-proto/src/blueprint_api.rs` — `root_is_parent`.
- `crates/mixengine-daemon/src/api/apply/` — where the root is resolved before planning, and
  `scaffold.rs` for `environment()`, the capture path and `failure()`.
- `crates/mixengine-cli/src/main.rs` — the `--path` default becomes "send the current directory and
  say it is a parent", and the flag's help text says so.
- `bindings/` — **generated**, by `bash packaging/bindings.sh`; the `bindings` CI job gates it.
- `docs/guide/en/cli.md` — **generated**. The `--path` help text is in the committed command
  reference and the `docs` CI job fails if it drifts; regenerate with
  `bash packaging/docs.sh --reference`.
- `apps/desktop/src/modules/mixengine/screens/Dashboard/QuickStart.tsx`,
  `apps/desktop/src/modules/mixengine/screens/Blueprints/ApplyDialog.tsx` and the two `i18n/`
  catalogues — D3.
- `.claude/features/blueprints.md` — the directory is named from the handle when nobody named it.
- `.claude/roadmap/phase-14-a-window-a-new-user-can-start-from.md` — T120a.

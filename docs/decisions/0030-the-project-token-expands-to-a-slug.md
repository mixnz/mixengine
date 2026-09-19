# 0030. A blueprint's `{project}` expands to a slug, not to the project's name

**Status**: Accepted
**Date**: 2026-09-12

## Context

A project's name is a label a person reads. `projects::validated_name` holds it to very little —
non-empty, at most sixty-four characters, no control character, no path separator — because that is
all a label needs to be. `laravel 1`, `My Blog`, `my_blog` and `a; rm -rf $HOME` are all legal
project names, and have been since phase 0.

A blueprint manifest carries a `{project}` token, and **T77** expanded it with
`value.replace("{project}", project)` — the project's name, verbatim. That value then lands in four
name spaces, none of which admits what a project name admits:

| Where it lands | Who decides the charset | What it allows |
|---|---|---|
| `[[services]] database`, `user` | `generate::databases::validated_identifier` | `[a-z0-9-]`, at most 32 |
| `[site] domain_pattern`, `aliases` | `domains::normalised` → `domain_syntax` | DNS labels, a managed TLD |
| `[[services]] instance = "per-project"` | `ServiceId::parse` | `[a-z0-9-]`, starting alphanumeric |
| `[scaffold] command` | a shell — `spawn_shell_supervised` | everything |

Applying the shipped `laravel` blueprint to a project called `laravel 1` therefore failed with
*"`laravel 1` cannot be a database or account name"* — **after** the project directory had been
created and Node, Composer and MariaDB downloaded and installed. Every blueprint in the gallery uses
the token, so every one was affected by any name that was not already a slug.

Two further findings came with it. The planner's promise that everything impossible is decided at
plan time (T77's D10) did not hold for either name: the database step checked only the *length* of
the account, and the domain step checked only who already held the name — so the dry run was green
and the apply failed. And the comment justifying the shell interpolation asserted that a project
name "has already been through the slug charset". It had not. The consent dialog does display the
expanded command, so a person is shown what they typed, but the invariant the code rested on did not
exist.

## Decision

**`{project}` expands to the project's handle — `domains::slug(name)` — and never to its name.**

That is not a new rule: `project.create` has derived a project's default domain with `domains::slug`
since **T39a**. This makes the blueprint planner ask the same function, so one project has one human
name and one machine handle rather than two answers to one question. The handle is computed once, at
the top of `plan()`, and passed down; `PlanAction::RegisterProject` keeps the unslugged name,
because that is what the person typed and nothing downstream of it has a charset.

**Every expanded name is then validated by the function that owns its name space**, at plan time:
`validated_identifier` for the database and the account, `domains::normalised` for each domain.
`database_step`'s hand-copied length constant is deleted — a copy of a rule is a place for the rule
to drift, and the rule's owner enforces it now. `ensure` already refused a pair that cannot be a
`ServiceId`.

**A name with no ASCII in it leaves the token unexpanded**, and each step that uses it blocks
itself. Blocking the registration instead would refuse a manifest that never mentions `{project}`
for no reason. Three of the four name spaces refuse `{project}` on their own rule; the shell has no
validator, so the scaffold step checks for a surviving token explicitly.

## Consequences

**A project called `My Blog` silently gets the database `my-blog`.** The plan is the answer: every
step is rendered before anything happens, and *creating the database my-blog on mariadb* is on the
screen next to the project's name. That is a plan doing its job, and it is strictly better than a
green plan and a failed apply.

**Two project names may slug to one handle.** Neither step invents a suffix to dodge it: the domain
step already blocks on a name another site holds, and `database.create` is idempotent, so a second
project pointing at one database is a person reusing it. The project rows stay distinct on the
untouched name. This is the position `domains::default_for` already takes — *"a collision is not
this function's business"* — and diverging from it here would be two policies for one question.

**The shell interpolation becomes safe by construction.** `domains::slug` answers in `[a-z0-9-]`,
which holds no shell metacharacter. The comment that claimed this now describes something true.

**Nothing on the wire changes**, so no bindings are regenerated and no protocol version moves.

**Nothing migrates.** A name that is already a slug slugs to itself, so every apply that works today
produces a byte-identical plan; the only behaviour that changes is behaviour that is currently a
failure. A database named from an unslugged project name cannot exist, because creating one is
exactly what failed.

## Alternatives rejected

**Tighten `projects::validated_name` to a slug.** The most consistent option, and the most
expensive: it invalidates names already registered on people's machines, needs a migration, and
solves in one place a problem that belongs to the four name spaces the token lands in. A project's
name is a label, and labels are allowed spaces.

**Refuse a non-slug project name at plan time and make the person retype it.** Honest, and it was
the second choice. Rejected because it makes somebody who has never read a naming rule learn one
before they can create their first site — which is the exact moment T117's Quick Start exists to
make easy.

**Escape the value for each name space instead of refusing.** Against the standing preference of
this codebase: `validated_identifier`, `validated_password` and `validated_slug` all refuse rather
than escape, and each one's doc comment says that the refusal is what makes quoting sufficient.

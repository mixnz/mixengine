# T120c — a folder somebody chose is the folder, and a scaffold says what it needs of one

**Date:** 2026-09-13
**Status:** accepted
**Roadmap:** phase 14, task **T120c** — the product answer to
[T120a](2026-09-13-t120a-a-scaffolds-directory-is-a-name-too-design.md), and the withdrawal of
**T120b**, which was written, measured, tried by hand and then rejected on what it did not fix.

## What was observed, and how

T120a made the daemon name the project's directory when no client had chosen one. Applying `nextjs`
from the desktop's **Blueprints** screen still failed, because that dialog's root box is required —
`disabled={… || root.trim() === ""}` — so every apply from it is, by T120a's own definition, "a path
somebody typed". The fix reached the CLI and Quick Start and left the door labelled *Blueprints*
exactly as it was.

**T120b flipped that default and was wrong.** It was implemented, built green, and tried: a checkbox
on the dialog, defaulting to *make a folder inside the one you chose*. It worked. It was rejected
anyway, and the reason is the whole of this task:

> a user who picks a folder wants **that** folder to hold the source. Making a different one inside
> it is a surprise, and the failure it dodges is still reachable — a user who insists on their
> folder still meets npm's own sentence, understands nothing, and stops using the product.

That is right, and it reframes the problem. **The defect was never the default; it was that the
refusal arrives late, in someone else's words, after a 50 MB download.** A default can make a bad
outcome rarer. Only an explanation can make it survivable.

### What npm actually refuses

Measured on 2026-09-13 against the gallery's exact command,
`npx --yes create-next-app@latest . --yes`, with no extra flags:

| Directory | Result |
|---|---|
| `next-js-1` | Success, `"name": "next-js-1"` |
| `next_js_1` | **Success**, `"name": "next_js_1"`, dependencies installed |
| `Next.js 1` | refused — capitals, and a space |
| `app(1)` | refused |
| `app~x` | refused |
| `.hidden` | refused |
| `_leading` | refused |

`create-next-app` has no name flag: `--help` offers `create-next-app [directory]` and nothing else,
and neither a pre-written `package.json` carrying a valid name nor passing the path as an argument
gets past the check — both measured, both refused. The directory's basename *is* the package name.

### The ruler this task nearly used, and why it is the wrong one

The obvious check is `domains::slug(basename) == basename`. It is wrong, and the row that proves it
is `next_js_1`: **slug turns every character outside `a-z0-9` into a hyphen, underscore included**,
so slugging would refuse a directory npm accepts and installs into. `slug` is the rule for a DNS
label. Measuring an npm package name with it is a category error, and `some_project` is how a large
part of the Python and Ruby world names directories.

## Goal

A person who chooses a folder gets their project in **that** folder; and when the folder's name is
one the blueprint's command cannot work with, they are told so before anything is installed, in
MixEngine's words, with the name to rename it to.

## Scope

**In**

- Every place a person chooses a folder uses it exactly.
- A blueprint declaring what its command needs of the directory's name.
- A plan-time block when that need is not met, naming the fix.
- A failed scaffold explaining itself when the block did not fire.
- The line breaks T120a put in a failure surviving to the screen.

**Out**

- `projects::validated_name`. T120 refused to narrow it, T120a repeated the refusal, and it stands:
  `Next.js 1` is a fine name for a project. It is the *folder* that npm judges.
- MixEngine moving or renaming a directory on anybody's behalf. *The files were never ours*
  ([ADR 0031](../../../.claude/decisions/0031-a-site-with-nothing-behind-it-is-answered-by-mixengine.md)),
  and scaffolding into one name and renaming to another is that rule broken from the inside.
- Changing the gallery's Next.js command. The alternatives — a template MixEngine maintains, a
  `degit` copy of an unpinned example, a shell one-liner that moves dotfiles portably — are each
  worse than the constraint.

## Decisions

### D1 — A folder somebody chose is the folder the source lands in

Wherever a person picks or types a directory, that directory is the project's:

| Gesture | Root sent | `root_is_parent` |
|---|---|---|
| `mix blueprint apply` with no `--path` | the current directory | `true` |
| `mix blueprint apply --path X` | `X` | `false` |
| Desktop → Blueprints → Apply | what the dialog holds | `false` |
| Desktop → Quick Start | the folder browsed to | `false` |

The last row **changes** T120a's D3, which had Quick Start send its folder as a parent. One gesture —
*choose a folder* — now means one thing in both windows. Its label goes back to naming the folder
rather than the place to put one.

### D2 — `root_is_parent` stays, for the one gesture where nobody chose

It is not dead with D1: `mix blueprint apply --project "Next.js 1"` with no `--path` names no
directory at all, so there is nothing to honour and MixEngine composes `<cwd>/next-js-1`. That is
T120a's measured behaviour and it is kept. The field's meaning is unchanged and no client that sends
`false` behaves differently.

### D3 — The constraint is declared by the blueprint, never inferred

`[scaffold]` gains an optional flag, beside the one that already describes what the command needs of
its directory:

```toml
[scaffold]
command = "npx --yes create-next-app@latest . --yes"
needs_empty_dir = true
needs_npm_safe_dir = true
```

Inferring it from the command's first word — `npx`, `npm`, `yarn` — was considered and refused: a
heuristic deciding whether to block somebody is the shape this codebase avoids everywhere else
(`validated_identifier`, `validated_slug`, T78b's program check all ask a rule, never a guess).

**Naming an ecosystem in the manifest is in keeping**, not against it: the format already says
`[runtimes] php`, `composer`, `[php] extensions`, `[[services]] mariadb`. A Ruby or Python scaffold
that one day needs the same protection gets its own flag carrying its own true rule, rather than
crowding into one vague flag that means something slightly different in each ecosystem — which is
the drift a name like `needs_slug_dir` would have started on day one.

### D4 — The rule is npm's, and it is written down rather than approximated

A basename is refused when any of these is true:

- it is empty, or longer than 214 characters;
- it holds an ASCII upper-case letter;
- it holds a character outside `a-z`, `0-9`, `-`, `_`, `.`;
- it begins with `.` or `_`.

Every clause is measured above. `next_js_1` and `next-js-1` pass; `Next.js 1`, `app(1)`, `app~x`,
`.hidden` and `_leading` are refused, exactly as `create-next-app` refuses them.

### D5 — Blocked at plan time, through the machinery that already exists

The step comes back `blocked`, which is what `needs_empty_dir` already does for a root that is not
empty and what T78b does for a program nothing answers to. No new plan concept, no wire change, no
new control: every client already renders a blocked step, and the desktop shows it in **Preview** —
before Apply, before a runtime is downloaded.

A blocked scaffold blocks the scaffold, not the apply, on T78b's standing rule: with a consent
naming that command the apply is refused up front; without one, everything else is applied and the
step is reported.

### D6 — Under-blocking is safe; over-blocking is not

The two mistakes are not symmetrical and the rule is written for that:

- **Refusing a directory that would have worked** leaves somebody forbidden from a legitimate thing
  with no way around it. `needs_slug_dir` would have done exactly this to `next_js_1`.
- **Missing a directory that fails** costs a wasted install and falls back to the readable message
  from T120a, which D8 improves further.

So where the rule is uncertain it permits. A dot inside the name is allowed on that basis.

### D7 — The refusal names what to rename the folder to

`slug` is not the ruler; it is the **generator**. It always produces a name D4 accepts, so the
blocked step's reason ends with the answer rather than the rule:

> `Next.js 1` is not a folder name this command can use: it takes its package name from the folder,
> and npm allows no capitals and no spaces. Rename the folder to `next-js-1` and apply again.

### D8 — A scaffold that fails anyway still explains itself

D3 covers blueprints that declare the flag. A blueprint somebody imported never will. So when a
scaffold step **fails**, its command is one of the npm family, and its directory's basename is not
npm-safe, the failure text gains one sentence pointing at the folder — covering the population D3
cannot reach.

**Amended after implementation.** The first draft asked only the folder, on the reasoning that it
cost one condition. It cost more than that: `composer create-project` takes its package name from
its argument, so a `composer` that failed over a network in a folder called `My Blog` would have
been answered with *this command takes its package name from the folder it runs in* — a false
sentence sending somebody to rename a folder for nothing, which is this task's own subject pointed
back at itself. The condition is now two, and the second is `program::bare_name` against
`npx`, `npm`, `yarn`, `pnpm`.

**That this is a guess, and D3 forbids guesses, is not a contradiction.** D3 forbids a guess
deciding whether to *refuse* somebody, where being wrong forbids a thing that works. Here the guess
only decides whether an already-failed step says one more sentence: a miss costs a hint, and the
narrowness is what stops a wrong guess costing anything at all. `./node_modules/.bin/create-next-app`
is not recognised and says nothing, which is the right way to be wrong.

This is not a substitute for D5 and is not treated as one: it arrives after the install, which is
the whole thing D5 exists to prevent.

### D9 — The lines reach the screen

T120a made a failure quote its command's last lines as lines. In the desktop they arrive inside a
`<p>` and HTML collapses a newline to a space, so the two npm rules render as one run-on sentence —
which is how the defect was reported the second time. `white-space: pre-wrap` on the step's text.

## Self-critique

**T120b was built and thrown away.** That is the honest record: a default was flipped, measured
working, and rejected because it answered the wrong question. What it cost is small and what it
bought is this task's premise — a comprehension failure is not fixed by making the failure rarer.
The one line worth keeping from it, D9, is kept.

**Quick Start gets harder for a first-time user.** D1 means somebody on their first run must have a
folder whose name works, and a blueprint with `needs_empty_dir` means it must be empty too. That is
friction at the worst possible moment, and it is accepted deliberately: two windows behaving
differently on one gesture is a worse and longer-lived confusion, and D7 turns the friction into a
single instruction that names the folder to use.

**The 214-character clause will never fire.** `projects::validated_name` stops at 64 and a path
component is bounded long before that. It is in D4 because the rule is npm's and copying half a rule
is how the two drift; it costs one comparison.

**An imported blueprint with an npm scaffold is not protected** until its author declares the flag.
D8 is the whole of the answer, and it is a smaller answer: the explanation arrives after the
download instead of before it.

**The gallery change reaches another repository.** `nextjs.toml` gains a line, so the signed release
in `mixengine-packages` goes stale until `publish-blueprints` is re-run at the new full SHA. That
obligation is now mechanical rather than remembered — `gallery.yml` dispatches `check-blueprints`
on the push (T125a), so forgetting is reported within a minute instead of on the next Tuesday.

**Security.** No new capability: a blocked step is a refusal, and refusals are free. D4 reads a path
component that this daemon was already given and already creates. The sentence in D7 puts a folder
name into text a terminal renders, and a path component reaching here has been through
`projects::validated_name`'s control-character refusal and T120a's escape scrub.

**Backward compatibility.** `needs_npm_safe_dir` defaults to `false`, so every manifest that exists —
imported, captured or published — plans exactly as it does today. `manifest::render` must round-trip
the new field or the gallery's canonical-form test fails, which is the test that will catch it.

## Acceptance

1. `nextjs` applied into a folder called `Next.js 1` is a **blocked plan step** naming `next-js-1`,
   with nothing downloaded and no directory created.
2. The same into `next_js_1` plans clean and scaffolds — the row that killed `needs_slug_dir`.
3. The same into `next-js-1` plans clean and scaffolds.
4. `app(1)`, `app~x`, `.hidden`, `_leading` are each blocked.
5. A blueprint without the flag is never blocked by it, whatever its folder is called.
6. Quick Start applies into the folder the person browsed to, byte for byte, and its label says so.
7. `mix blueprint apply --project "Next.js 1"` with no `--path` still composes `./next-js-1`.
8. An **npm-family** scaffold that fails in a folder D4 refuses gains the explaining sentence, and a
   `composer` one that fails in the same folder does not (D8).
9. A failed step's quoted lines render as lines in the desktop (D9).
10. `manifest::render` round-trips the new field; the gallery stays canonical.

## Files

- `crates/mixengine-core/src/blueprints/manifest.rs` — the field, and its canonical rendering.
- `crates/mixengine-core/src/blueprints/gallery/nextjs.toml` — the one blueprint that declares it.
- `crates/mixengine-core/src/blueprints/plan.rs` — the check and the blocked step's reason.
- `crates/mixengine-daemon/src/api/apply/scaffold.rs` — D8's sentence.
- `apps/desktop/src/modules/mixengine/screens/Dashboard/QuickStart.tsx` and
  `screens/Blueprints/ApplyDialog.tsx` — D1, and the now-unused `rootIsParent` prop.
- `apps/desktop/src/modules/mixengine/i18n/{en,vi}.ts` — the Quick Start label returns.
- `apps/desktop/src/modules/mixengine/screens/Blueprints/ApplyDialog.module.css` — D9.
- `.claude/features/blueprints.md`, `.claude/roadmap/phase-14-*.md`, `CHANGELOG.md`.
- **Another repository:** re-run `publish-blueprints` in `mixengine-packages` at the new full SHA.

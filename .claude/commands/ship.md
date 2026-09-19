---
description: Take a task from design to a squash-merged PR — design, self-review, spec, plan, execute, CI green, merge
argument-hint: <task description>
disable-model-invocation: true
---

# Ship a task end to end

Branch: !`git rev-parse --abbrev-ref HEAD`
Uncommitted: !`git status --porcelain`

Task: $ARGUMENTS

Act as a senior AI software engineer. **Invoking this command authorizes** every commit, push, CI dispatch, PR and squash merge below
for this task only, without stopping for feedback between phases. Stop only on a failure you cannot resolve yourself, and say why.
Every rule in CLAUDE.md still applies — commit format, branch naming, PR body, merge syntax, no subagents.

## Phase 1 — Design & critique

1. Read the relevant specs in `docs/features/` and the code involved, then propose a detailed architecture/solution.
2. Switch role to Staff Principal Engineer and attack it: latent bugs, edge cases, performance and security risks, cross-platform
   gaps. Revise the design until none of those findings stand.

## Phase 2 — Spec & Git

3. Write the full spec to `docs/specs/YYYY-MM-DD-<topic>-design.md`, opening with a `status: draft` header (docs/standards/plans-and-specs.md), then re-read it against the design: no
   placeholders, no contradictions, nothing ambiguous.
4. Confirm `master` is pushed and in sync, then create a new branch off it.
5. Commit the spec alone.

## Phase 3 — Plan

6. Use `superpowers:writing-plans` to produce the detailed plan from the spec.

## Phase 4 — Execute & CI

7. Use `superpowers:executing-plans`: run every task in order, one commit per task, straight through to the end. Gate each task
   with CLAUDE.md's *Common commands* for what it touched. Tick the roadmap phase file where the plan says so.
8. Push and run CI the way `/watch-ci` does (`bash scripts/ask-ci.sh`, then `bash scripts/watch-ci.sh`) — a push alone starts no run.
9. Red → classify and fix per `/watch-ci`, commit, push, dispatch again. Repeat until an `all` run is green.

## Phase 5 — Finish

10. Open a PR into `master` (`## Summary` only).
11. Squash merge with `(#id)` appended to the subject, then delete the branch locally and on the remote, and leave the local
    `master` pulled and clean.

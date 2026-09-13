---
description: Run the CI loop until every check is green — watch, classify, fix, gate, commit, ask again
argument-hint: [branch or note, optional]
allowed-tools: Bash(bash scripts/ask-ci.sh:*), Bash(bash scripts/watch-ci.sh:*), Bash(gh run:*), Bash(git rev-parse:*), Bash(git status:*)
disable-model-invocation: true
---

# Watching CI until green

Branch: !`git rev-parse --abbrev-ref HEAD`
HEAD: !`git rev-parse HEAD`
Uncommitted: !`git status --porcelain`

User's note for this round (may be empty): $ARGUMENTS

**Invoking this command authorizes** committing, pushing and dispatching a run on the working branch, once per round, without asking again. Nothing else: no force push, no PR, no merge, no tag, nothing committed or pushed on `master`.

## The loop

**Before asking, check whether this commit already did.** The branch is `$ARGUMENTS` when that names one, otherwise the one above — and the
question is its **HEAD**, not the branch, so a fresh commit has asked nothing yet. `bash scripts/watch-ci.sh --once` answers for the current
branch: exit 2 is a run already in flight, so go to step 2 rather than start a second one answering the same question; exit 1 printing `no
run for <sha>` is the one exit 1 that is not red, and means nothing was asked. For a branch by name, match its HEAD in `gh run list --branch
<name> --json databaseId,headSha,status` and hand that id to `bash scripts/watch-ci.sh <id>`, which skips the current-branch lookup.

1. `bash scripts/ask-ci.sh` — pushes this branch and dispatches a run. `ci.yml` fires by itself on a `v*` tag and on nothing else, so a push alone produces no run. `--watch` chains step 2 onto it.
   `--jobs <lint|test|system|bench|bindings|docs|desktop|build>` narrows the run to one job and skips every other. **A narrowed answer is not an answer about the workspace**: ask for `all` before believing it.
2. `bash scripts/watch-ci.sh` — picks the run **by the SHA of HEAD**, never by recency. A run outlives a foreground command: background it, or poll `--once`. Exit 0 green, 1 red, 2 running, 64 misuse.
3. **Red** → classify below, fix one thing, gate it, one commit, back to step 1. A push without a dispatch leaves the previous run standing as the newest answer.
4. **Green on an `all` run** — *every* job settled, not only the ones the change was about — → stop and wait. Report the run id, the branch, one line per fix, and which failures were flakes or noise.

**Red on `master`:** cut `git checkout -b <short-name-for-the-failure>` first — named after the failure, never the word "claude" in any casing — and run the loop there. `master` stays unpushed.

## Classify before fixing

**The printed block is an extract, and the extract can be the noise rather than the error.** Read the full log the script saved — its path is the last line it
printed — and grep that job's own lines to the end (`error[`, `banned`, `duplicate`, `FAILED`, `Process completed with exit code`). `EXTRACT_LINES=500` keeps more on screen.

| What CI says | What it is | What to do |
| --- | --- | --- |
| `lint`: a `rustup` backtrace, "override toolchain … is not installed" | fixed noise of the cargo-deny container, printed on green runs too | ignore it; the real error is further down that job |
| `test (windows-latest)`: `All pipe instances are busy`, os error 231 | a flake of the Windows IPC retry budget | `gh run rerun --failed`; green means flake, note it and move on |
| `bench (ubuntu-latest)`: `three_services_start_together_inside_the_budget` over budget | a bimodal distribution the budget sits inside; a clean `master` sits on the edge too | dispatch `master` as a same-time control and compare medians *before* reading any code |
| a job with no failing step — killed at setup, cancelled, runner lost | infrastructure | rerun that job |
| a step needing a repository secret or a person's one-time setting (`PACKAGES_DISPATCH_TOKEN`, GitHub Pages) | not yours to fix | stop and say so |
| the same failure twice on the same commit, identically | a real failure | fix it |

## Gate the fix before pushing

A red run costs fifteen to twenty minutes. Run CLAUDE.md's *Common commands* for what the fix touched — `fmt`, `clippy`, the suites, `cargo doc`, and where reached `sqlx prepare`, `bindings.sh`, the `apps/desktop` lane.

**The gate's silence is not a verdict.** This machine never compiles the `linux/` and `macos/` files (check those in WSL), a release-profile
failure is invisible to a debug check, `dns::server` is red here on a clean tree, and the workspace under WSL hangs on the secrets suite. A
step copied out of `ci.yml` needs that job's environment (`CARGO_TERM_COLOR=always CARGO_INCREMENTAL=0 RUST_BACKTRACE=1`) to mean anything.

## Red flags — stop, do not push

Weakening a test (delete, `#[ignore]`, `#[allow(...)]`, a raised bench budget), `--no-verify`, `todo!()` on an unsupported path, editing an accepted ADR, a commit or push on `master`, or `gh pr create` / `gh pr merge` / `git merge` / `git rebase` / a `v*` tag — none are the loop.

| Excuse | Reality |
| --- | --- |
| "The extract shows the error" | It shows *an* extract. The full log is a file on disk; read it. |
| "Red on one OS only, so it is a flake" | A matrix failing on one leg is the normal shape of a real per-OS bug. Only the table above names flakes. |
| "It is green locally" | This machine compiles one OS in one profile, and some of its suites are red on a clean tree. Locally green is not evidence. |
| "Just a fmt fix, push it" | Gate it anyway. `fmt` and `clippy` together take less than one CI round. |
| "The run before this one was green" | `watch-ci.sh` answers about HEAD. A green answer about another commit is not about this one. |
| "`--jobs test` came back green" | It answers about `test`, with the other eight skipped. Only an `all` run ends the loop. |
| "The fix is one line, `master` can take it" | Size is not the question. A red `master` gets a branch; the loop never commits to `master`. |
| "The same fix did not work, try another" | Twice with no new understanding between them is not a round. Report what each round learned. |
| "It is green, so it is ready — I will open the PR" | Green ends the loop. A green run makes the work reviewable, not merged; opening or merging is the user's call, asked for separately — including when the PR already exists. |

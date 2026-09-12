---
name: watching-ci-until-green
description: Use when CI's verdict is what the work is waiting on in this repository — a branch just pushed, a fix just committed, a run red on one OS only, a job whose log has to be read, or a run that has not been asked for yet.
---

# Watching CI until green

CI is the only thing that compiles this workspace for all three operating systems and the only judge
of a change. This is the loop from a pushed branch to every check green: watch, classify, fix, gate,
commit, ask again — until `watch-ci.sh` exits 0.

**Invoking this skill authorizes the loop**: committing, pushing and dispatching a run on the
**working branch**, once per round, without asking again between rounds. It authorizes nothing else —
no force push, no PR, no merge, and no commit or push on `master` (see *Red on `master`* below).

## The loop

1. **Ask for the run.** `ci.yml` fires by itself on a `v*` tag and on nothing else, so a push alone
   produces no run. `bash scripts/ask-ci.sh` pushes the current branch and dispatches a run on it.
2. **Watch it.** `bash scripts/watch-ci.sh` picks the run **by the SHA of HEAD**, never by recency.
   A full run outlives an agent's foreground command, so either run it in the background or poll
   `bash scripts/watch-ci.sh --once` — exit 2 means the run has not finished.
   Exit status: 0 success, 1 failure, 2 still running (`--once` only), 64 a misuse of the script.
3. **Green → step 5.** Green is *every* job settled green, not only the ones the change was about.
4. **Red → classify first** (below), fix one thing, gate it locally, commit it, then back to step 1.
5. **Green → stop and wait** (*Where the loop ends*, below). The loop ends at green. It does not
   open a pull request and it does not merge one.

## Red on `master`

If the run being watched is `master`'s and it comes back red, **the fixes do not go on `master`**.
Before writing any fix:

```bash
git checkout -b <short-name-for-the-failure>     # never the word "claude", in any casing
```

Then run the loop on that branch: gate, commit, `bash scripts/ask-ci.sh` (which pushes *this* branch
and dispatches a run on it), watch. `master` itself stays untouched and unpushed — nothing here
commits to it, and the branch is what carries the answer back to the user.

Naming: name the branch after the failure, not after the fix you have not made yet — `lint-winapi`,
`bench-warm-start`, `windows-pipe-busy`.

## Classify before fixing

**The printed block is an extract, and the extract can be the noise rather than the error.** Read the
full log the script saved — its path is the last line it printed, `…/mixengine-ci-<run>.log` — and
grep that job's own lines to the end (`error[`, `banned`, `duplicate`, `FAILED`,
`Process completed with exit code`). `EXTRACT_LINES=500` keeps more on screen.

| What CI says | What it is | What to do |
| --- | --- | --- |
| `lint`: a `rustup` backtrace, "override toolchain … is not installed" | fixed noise of the cargo-deny container, printed on green runs too | ignore it; the real error is further down the same job's log |
| `test (windows-latest)`: `All pipe instances are busy`, os error 231 | a flake of the Windows IPC retry budget, unrelated to the branch | `gh run rerun --failed` on that run; green means flake, note it and move on |
| `bench (ubuntu-latest)`: `three_services_start_together_inside_the_budget` over budget | a bimodal distribution the budget sits inside; a clean `master` also sits on the edge | dispatch `master` as a same-time control and compare medians *before* reading any code |
| a job with no failing step — killed at setup, cancelled, runner lost | infrastructure | rerun that job |
| the same failure twice on the same commit, identically | a real failure | fix it |

A failure that needs a repository secret or a person's one-time setting (for example
`PACKAGES_DISPATCH_TOKEN`, or GitHub Pages) is not yours to fix: stop and say so.

## Gate the fix before pushing

A red run costs fifteen to twenty minutes, so never spend one on something this machine could have
answered. Before each push, run what the fix touched:

```bash
cargo fmt --all --check                  # clippy clean != fmt clean
cargo clippy --workspace -- -D warnings
cargo test -p <crate> <suite>            # the suites the fix touched
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps --document-private-items --all-features
```

Plus, when the change reached them: `cargo sqlx prepare --workspace -- --all-targets --all-features`
after a `sqlx::query!`, `bash packaging/bindings.sh` after a type in `mixengine-proto`, and the
desktop lane in `apps/desktop` (`npm run build && npm test && npm run lint`, then
`cargo clippy --locked --all-targets -- -D warnings` in `src-tauri`) after touching it.

**What the local gate cannot tell you**, so do not read its silence as a verdict: this Windows
machine never compiles the `linux/` and `macos/` files (check those in WSL), a release-profile
failure is invisible to a debug check, and some suites are red here on a clean tree for reasons that
belong to the machine — `dns::server` (WSAEACCES on an ephemeral port), and the whole workspace run
under WSL, which hangs on the secrets suite. A step copied out of `ci.yml` also needs that job's
environment (`CARGO_TERM_COLOR=always CARGO_INCREMENTAL=0 RUST_BACKTRACE=1`) to mean anything.

## Commit and go round again

One commit per fix, `<type>(<scope>): <message>` with an English imperative message, on the branch
already in flight. Then `bash scripts/ask-ci.sh` again — the push alone would leave the previous run
as the newest answer — and watch the new run, which is a new run id.

## Where the loop ends

**At green, and at green only. Then stop and wait for the user.** Report the run id that answered,
the branch it answered about, and one line per fix that got there — including which failures turned
out to be flakes or noise rather than code.

What happens next is the user's call, not the loop's: **do not open a pull request, do not merge one,
do not merge or rebase a branch, do not tag a release.** A green run makes the work reviewable; it
does not make it merged. This holds even when a PR for the branch already exists and its checks are
now green — a green PR is still a PR waiting for a person.

## Red flags — stop, do not push

- Deleting, `#[ignore]`-ing or weakening a test to make a job green.
- `#[allow(...)]` over a clippy finding, `--no-verify`, or raising a bench budget.
- Editing an accepted ADR, or reaching for `todo!()` on an unsupported path.
- A commit or a push on `master` — the fixes belong on a branch cut off it.
- `gh pr create`, `gh pr merge`, `git merge`, `git rebase`, or a `v*` tag. None of those are the loop.
- The same fix pushed twice with no new understanding between them — report instead of iterating.
- Three rounds gone and the failure is not better understood than in round one — stop and report
  what each round learned.

| Excuse | Reality |
| --- | --- |
| "The extract shows the error" | The extract shows *an* extract. The full log is a file on disk; read it. |
| "Red on one OS only, so it is a flake" | A matrix failing on one leg is the normal shape of a real per-OS bug. Only the table above names flakes. |
| "It is green locally" | This machine compiles one OS in one profile, and some of its suites are red on a clean tree. Locally green is not evidence. |
| "Just a fmt fix, push it" | Gate it anyway. `fmt` and `clippy` together take less than one CI round. |
| "The run before this one was green" | `watch-ci.sh` answers about HEAD. A green answer about another commit is not about this one. |
| "I will ask CI once for all the fixes" | Fine — one commit each, one dispatch after the last. What is not fine is pushing without dispatching. |
| "The fix is one line, `master` can take it" | Size is not the question. A red `master` gets a branch; the loop never commits to `master`. |
| "I cut the branch off a red `master`, so its run will be red too" | The branch's run answers about the branch. Red inherited from `master` is exactly what the fix on it is for. |
| "It is green, so it is ready — I will open the PR" | Green ends the loop. Opening or merging a PR is the user's decision, asked for separately. |
| "The PR already exists, merging is just the last step" | It is the step this skill does not have. Report green and wait. |

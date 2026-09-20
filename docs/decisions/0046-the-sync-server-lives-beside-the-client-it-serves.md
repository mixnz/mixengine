# 0046. The sync server lives beside the client it serves

**Status**: Accepted — supersedes decision 4 of
[0045](0045-mixlab-has-an-account-and-mixengine-does-not.md) and, with it, decision 6 of
[0044](0044-mixlab-is-the-product-and-mixengine-is-the-engine.md), which named a repository that no
longer exists
**Date**: 2026-09-20

## Context

[ADR 0045](0045-mixlab-has-an-account-and-mixengine-does-not.md) decision 4 put the sync server in
`mixnz/mixlab-sync`, a repository of its own, *"from its first commit"*. It also named the cost it
was accepting — two repositories describing one protocol — and the mitigation: the contract stays
normative here, `/v1` is frozen, and a conformance suite is written against the document rather than
against the code.

**That first commit never happened**, and in the hours between then and now four of the five reasons
for splitting were either dissolved or answered.

- **The dependency tree.** The strongest reason was keeping a web framework and a database driver
  out of the root workspace. A Cloudflare Worker joins no Cargo workspace at all, and a
  TypeScript one is an npm project of the kind `apps/desktop/` already is. The native
  implementation is Rust and does need keeping out — which `Cargo.toml`'s `exclude` list already
  does for `apps/desktop/src-tauri`, for the same reason and with the same two words.
- **The lifecycle.** A subdirectory deploys on its own: Workers Builds takes a root directory, so
  `server/worker/` is what Cloudflare builds and the rest of the repository is not its business.
- **Self-hosting.** *"Clone something small"* was the picture. The actual path is forking this
  repository and pointing Workers Builds at a directory, or pulling an image — in neither does
  anybody read the tree they cloned.
- **The repository boundary as a forcing function**, keeping the server from learning what a record
  is. Still worth having, but this repository already enforces boundaries with lints and tests
  rather than with walls between repositories — `npm run lint`, `workspace_layering.rs`,
  `apps/desktop/src-tauri/tests/layering.rs`.

Only the licensing argument survives untouched, and a directory can carry its own `LICENSE`.

**And a reason to merge appeared that did not exist when 0045 was written.** The protocol is
normative *here*, so the server repository would have held a Worker and a test suite whose
defining document lives somewhere else: high coupling, thin contents. Against that stands
[ADR 0027](0027-the-desktop-client-lives-in-this-repository.md)'s own argument for bringing the
desktop client home, which applies here word for word:

> a type reshaped in `mixengine-proto` fails the desktop typecheck in the same CI run, not in
> another repository weeks later.

Today nothing checks `apps/desktop/src-tauri/src/sync/` against a server at all. In one repository,
one CI run can start the Worker and point the conformance suite at it — an integration test between
the two halves that two repositories cannot have without publishing an artifact first.

## Decision

**The sync server lives in this repository, under `server/`.**

```
server/
  conformance/   the suite both implementations answer to
  worker/        Cloudflare Workers and Durable Objects — the default instance
  native/        Rust and a SQLite file, for a machine somebody runs themselves
```

1. **`conformance/` sits beside the implementations rather than inside one**, so that the tree says
   what the arrangement is: one suite, two implementations, neither of them the definition. It is
   still written before the first server, and still against the document — that requirement is
   0045's and survives unchanged.

2. **`server/native/` is excluded from the root Cargo workspace**, the way
   `apps/desktop/src-tauri` is and for the reason `Cargo.toml` already gives there: its tree would
   defeat `deny.toml`'s duplicate-version ban and the elevated helper's dependency budget.

3. **The container image is built from `server/native/` and is not a directory of its own.** It is a
   way of packaging the second implementation, not a third implementation.

4. **CI proves the two halves agree.** A job starts the Worker and runs `server/conformance/`
   against it, and does the same for `native/`. This is what the merge buys and it is the reason
   for it.

5. **There is no `mixnz/mixlab-sync`.** The repository was created and then deleted without ever
   receiving a commit, so nothing is stranded and no link to it was ever published. Anything that
   still names it is out of date, and `server/` in this repository is what it means.

**Everything else in [ADR 0045](0045-mixlab-has-an-account-and-mixengine-does-not.md) stands**:
the account belongs to MixLab's toolbox and `mix` does not sign in; the server cannot read what it
holds; nothing syncs until a person says which things do; the contract is normative in this
repository and `/v1` is frozen; and ADR 0022 is unweakened.

## Consequences

**Easy.** One history, one branch and one pull request for a change that touches both halves. The
conformance suite and the document it is written against are in the same tree, so the staleness
`.github/workflows/gallery.yml` exists to shout about cannot occur here. And the integration test
above becomes possible at all.

**Hard, and accepted.** This repository grows a third toolchain area — `server/worker/` has its own
npm project and its own `wrangler.toml`, and `server/native/` a third Cargo workspace. The root
`cargo` still sees neither. Self-hosting reads as *fork this and point a build at a directory*
rather than *clone this small thing*, which is a worse sentence for a person who wanted the small
thing and an identical experience for everybody who forks or pulls an image.

**What would reverse this.** If the server ever needs a release cadence of its own — versioned
artifacts somebody installs, rather than a deployment and an image — the lifecycle argument comes
back with weight it does not have today, and the split is worth revisiting in a new decision.

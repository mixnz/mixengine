# Phase 23 — One home for the documentation

*Goal: every document written for people lives under `docs/`, every spec says whether it was
built, and CI fails on a dead link into the documentation.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-19-t169-one-home-for-the-documentation-design.md](../specs/2026-09-19-t169-one-home-for-the-documentation-design.md).
Decision: [ADR 0043](../decisions/0043-documentation-lives-under-docs.md).

---

- [x] **T169a** Everything under `.claude/` except the agent configuration, and
      `docs/superpowers/specs/`, moved into `docs/` by `git mv`; `.claude/desktop/` split into
      `desktop/` subfolders of the folder each document belongs to.
- [x] **T169b** Every reference rewritten — Markdown links, path mentions, rustdoc reference
      links, `include_str!` and absolute GitHub URLs — `bindings/` regenerated, the two
      plans-and-specs pages merged, `.agent/` labels and the dead links that predate the move
      fixed, `docs/README.md` rewritten as the map, and a stub left in `.claude/`.
- [x] **T169c** A `status`/`date` header on every spec, the old prose status lines removed, and
      `docs/specs/README.md` generated from the headers.
- [ ] **T169d** `scripts/check-docs.mjs` and its tests, run in the `lint` job.

**Milestone M23**: on `master`, the `lint` job runs `node scripts/check-docs.mjs` and it passes;
`.claude/` holds no document but its README; every spec's status agrees with the roadmap.

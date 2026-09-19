# Phase 25 — A workflow a person can read

*Goal: a person can read the CI job they are changing without reading the other thirteen, and CI
checks exactly what it checked before.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t172-a-workflow-a-person-can-read-design.md](../specs/2026-09-20-t172-a-workflow-a-person-can-read-design.md).

---

- [x] **T172a** Every "Fetch a real X" step goes through `.github/scripts/fetch-package.sh`, which
      learns `--absent-on` and `--probe`.
- [x] **T172b** The clock/budget pair and "Choose the release profile" are composite actions under
      `.github/actions/`.
- [x] **T172c** No `run:` block passes 15 lines of code; the four that did are scripts.
- [x] **T172d** Workflow comments say why; history moves to "Why CI is shaped this way" in
      `docs/operations/build-and-release.md`.
- [ ] **T172e** `ci.yml` calls one workflow per job family and is about 250 lines or less.

**Milestone M25**: no file under `.github/workflows/` passes 500 lines, `ci.yml` is about 250 or
less, and a full run matches the `master` run before T172 in its jobs, its test counts and its
artifacts.

# Phase 21 — A site that stays up

*Goal: a site that was up stays up until a person stops it. MixEngine stops nothing on its own
unless a person has turned on Save battery, and the web server comes back with the daemon.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-19-t167-a-site-that-was-up-stays-up-design.md](../../docs/superpowers/specs/2026-09-19-t167-a-site-that-was-up-stays-up-design.md).
Decision: [ADR 0041](../decisions/0041-mixengine-stops-nothing-a-person-did-not-ask-it-to.md).

---

- [ ] **T167a** The wire. `ServiceSummary.stopped_by` (`never` | `person` | `daemon`, optional per
      ADR 0019), `SaveResources` / `SaveResourcesSet`, and the methods `service.save_resources` and
      `service.set_save_resources`.
- [ ] **T167b** Idle off by default. Every `Recipe::idle_default()` answers `None`; T70/T70a's numbers
      move to `idle_when_saving()`, used for a `NULL` row only while the `settings` row
      `services.save_resources` is on. The two methods read and write it.
- [ ] **T167c** `mix service save-resources [--on|--off]`.
- [ ] **T167d** `stopped_by` filled on every `ServiceSummary` for a stopped service.
- [ ] **T167e** The front end comes back with the daemon. A front end is created with `autostart` on
      unless asked otherwise; `blueprint.apply` no longer sends `Some(false)`; a one-time migration
      turns it on for existing `caddy` / `nginx` rows.
- [ ] **T167f** *This site is starting…* — the page a front end serves for a site with a backend
      whose upstream is down, instead of the empty-site welcome page.
- [ ] **T167g** MixLab: *Save battery* in Settings, keep-warm gone from the project form and table,
      a daemon-stopped service drawn as *Resting* rather than a red *Stopped*.

**Milestone M21**: on macOS and Windows, a daemon restart leaves every site answering without a
click, and with Save battery off nothing is stopped however long it sits idle.

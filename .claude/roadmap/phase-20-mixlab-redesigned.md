# Phase 20 — MixLab redesigned

*Goal: every screen of every module is drawn from one token set, in a light and a dark theme, at
the density its content needs, and matches the design canvas where the canvas covers it.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done · **(P)** =
has a platform-layer component and needs verification on Windows + macOS + Linux.

Design: [2026-09-17-t157-mixlab-redesign-design.md](../../docs/superpowers/specs/2026-09-17-t157-mixlab-redesign-design.md).

---

**The case this comes from**: a design canvas redrew MixLab dark, in Geist, with content in
bordered cards; a light draft of it was accepted the same day. The window had two themes, ten
accents, an opt-in glass look and a four-step type scale, and most of its stylesheets already spoke
in tokens — so the work starts at the tokens and moves outwards one area at a time.

- [x] **T157** Foundation — glass removed; `data-theme` always resolved; Geist; the two-theme token
      set with mint as default and four-handle accents; two densities; syntax and terminal tokens;
      `contrast.test.ts` and the `colourLiterals.test.ts` ratchet; the ADR. Design D1–D9.
- [x] **T158** Components — every shared component restyled and the new ones (Switch,
      SegmentedControl, FilterChip, StatusPill, Card, PageHeader, Table, MonogramBadge, Popover,
      EmptyState) added, with the shared-components skill updated.
- [x] **T159** Shell — tab bar, Settings modal, FirstRun, TabNotice.
- [x] **T160** MixEngine I — gate, sidebar, Dashboard, Projects, Sites and its dialog, Domains & TLS.
- [ ] **T161** MixEngine II — Runtimes, PHP extensions, Services, Blueprints, Metrics, Logs,
      Add-ons, Settings, the remaining dialogs.
- [ ] **T162** `db` — the connection editor, the compact workspace, its dialogs.
- [ ] **T163** REST, Terminal (xterm reads `--ansi-*`), Tools; both colour-literal baselines empty.

**M20**: every screen renders in both themes with no colour literal outside `App.css`, the contrast
test green, and the connection editor, Dashboard and Interaction states matching their artboards
side by side.

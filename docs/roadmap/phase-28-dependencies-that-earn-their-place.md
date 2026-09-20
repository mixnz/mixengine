# Phase 28 — Dependencies that earn their place

*Goal: nothing is compiled, shipped or audited because a plugin's default feature asked for it.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t175-dependencies-that-earn-their-place-design.md](../specs/2026-09-20-t175-dependencies-that-earn-their-place-design.md).

---

- [ ] **T175a** The clipboard plugin is replaced by a direct `arboard` dependency without
      `image-data`, and `image` (44.5 s), `moxcms` (54.6 s) and the plugin leave the tree.
- [ ] **T175b** `mongodb` is taken without default features, keeping `bson-3`, `rustls-tls` and
      `dns-resolver`; bson 2 (26.0 s) leaves the tree.
- [ ] **T175c** Whether `modules/db` — 28,786 of this crate's 34,000 lines — becomes a crate of its
      own is decided by one measured build against the bar in D3, two minutes off the `window`
      leg's cargo wall, and the answer is written here either way.

**Milestone M28**: the `--timings` report for the `window` leg holds no `image`, no `moxcms` and no
`bson 2`, pasting into the terminal still works on all three systems, and T175c's measurement is
recorded whichever way it went.

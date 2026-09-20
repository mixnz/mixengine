# Phase 28 — Dependencies that earn their place

*Goal: nothing is compiled, shipped or audited because a plugin's default feature asked for it.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t175-dependencies-that-earn-their-place-design.md](../specs/2026-09-20-t175-dependencies-that-earn-their-place-design.md).

---

- [ ] **T175a** The clipboard plugin is replaced by a direct `arboard` dependency without
      `image-data`, and `image` (44.5 s), `moxcms` (54.6 s) and the plugin leave the tree.
- [x] **T175b** ~~`mongodb` without default features~~ — **tried and withdrawn**. `compat-3-0-0` is
      not a spare copy of bson: it is what makes `mongodb::bson` *be* bson 2, and this application
      is written against that API. Without it the compile refused in 23 places — 22 in
      `modules/db/drivers/mongo.rs`, one in `drivers/dump.rs` (`to_document` gone, `de::Error`
      private, `raw::CString` no longer `From<&str>`). The driver also demands `compat-3-3-0`, an
      empty flag that only makes a caller promise forward compatibility. 26 seconds of compile is
      not a reason to port a dump format; see the spec's F2 and D2.
- [ ] **T175c** Whether `modules/db` — 28,786 of this crate's 34,000 lines — becomes a crate of its
      own is decided by one measured build against the bar in D3, two minutes off the `window`
      leg's cargo wall, and the answer is written here either way.

**Milestone M28**: the `--timings` report for the `window` leg holds no `image` and no `moxcms`,
pasting into the terminal still works on all three systems, and both measured answers — T175b's and
T175c's — are recorded whichever way they went.

# Phase 28 — Dependencies that earn their place

*Goal: nothing is compiled, shipped or audited because a plugin's default feature asked for it.*

Part of the [build plan](todo.md). Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

Design: [2026-09-20-t175-dependencies-that-earn-their-place-design.md](../specs/2026-09-20-t175-dependencies-that-earn-their-place-design.md).

---

- [x] **T175a** The clipboard plugin is replaced by a direct `arboard` dependency without
      `image-data`, and `image` (44.5 s), `moxcms` (54.6 s) and the plugin leave the tree. The one
      call it served, the terminal's paste, is `terminal_clipboard_text` — and it was checked by
      pasting, since no test proves a clipboard reads.
- [x] **T175b** ~~`mongodb` without default features~~ — **tried and withdrawn**. `compat-3-0-0` is
      not a spare copy of bson: it is what makes `mongodb::bson` *be* bson 2, and this application
      is written against that API. Without it the compile refused in 23 places — 22 in
      `modules/db/drivers/mongo.rs`, one in `drivers/dump.rs` (`to_document` gone, `de::Error`
      private, `raw::CString` no longer `From<&str>`). The driver also demands `compat-3-3-0`, an
      empty flag that only makes a caller promise forward compatibility. 26 seconds of compile is
      not a reason to port a dump format; see the spec's F2 and D2.
- [x] **T175c** Whether `modules/db` — 28,786 of this crate's 34,000 lines — becomes a crate of its
      own: **measured, and the answer is no.** `mixlab` builds in 88.4 s whole and 47.0 s with `db`
      unhooked, so `db` is 47% of the compile rather than the 85% its line count suggests. Two
      halves that size do not pipeline into two minutes — the ceiling is 60 to 150 s in CI, with the
      bar inside it — and settling which side would cost the refactor it was meant to justify: a
      third crate for `error`/`platform`/`ssh`/`secrets`, and a cut through the `db` ↔ `launch`
      cycle. **The split would halve a local rebuild for anyone editing the shell, 88 s to 47 s**;
      that is a better argument, a different bar, and a spec of its own.

**Milestone M28** — **met**, by run 35495658721's report and a paste on this machine:

| | before (35486085024) | after (35495658721) |
| --- | --- | --- |
| units in the graph | 908 | **898** |
| `image` / `moxcms` | 44.5 s / 54.6 s | **neither is there** |
| `arboard` | 3.1 s | 0.5 s |

Pasting into a terminal was checked by hand, because nothing tests that a clipboard reads. The rest
of the drop between those two reports — 2498 s of work to 1124, `mixlab` 306 s to 76 — is T173's
`opt-level = 0` and not this phase's; the two land in the same table and are worth telling apart.

**Both refusals are recorded above, with their numbers.** One task in three changed anything, which
is what a phase looks like when the measurements are allowed to answer.

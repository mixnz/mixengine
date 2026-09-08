# Changelog entries

A change a user would notice gets a line in [CHANGELOG.md](../../CHANGELOG.md) **as part of the
work**, not at release time. It goes under `## [Unreleased]`, and under one of three headings.

```markdown
## [Unreleased]

### Added

- Ctrl+R reloads the pane on screen instead of the app.

### Changed

- The Query tab remembers its draft per saved connection, not per tab.

### Fixed

- Renaming a table no longer clears the filter bar.
```

## Rules

- **Three headings, nothing else**: `### Added`, `### Changed`, `### Fixed`, in that order. Only
  the ones that have entries appear. Nothing sits loose under `## [Unreleased]` without a heading.
- **Which one**: `Added` for a capability that did not exist, `Changed` for one that now behaves
  differently, `Fixed` for a bug **in a released version**.
- **One line each, plain and short.** Say what a user can now do, or what now behaves differently.
  A change someone has to adapt to may run to two or three lines — nothing here ever needs more.
- **The first entry is the headline.** The update panel in the corner of the app shows the first
  line of the release's notes and nothing else, so the biggest change goes at the top.
- **Small interface fixes share one line, at the foot of `### Fixed`.** Spacing, alignment, a
  colour, a control sitting a pixel out — each is a real fix and none of them is worth a line of a
  reader's attention on its own. They go in a single entry at the bottom of the section, naming
  where rather than what: *"Spacing and alignment fixes in the toolbar buttons, the history list
  and the connection form."* One line per release, added to as more of them land. A visual bug that
  changed what someone could **do** — text that could not be read, rows cut off the bottom of a
  table, a button that could not be reached — is not one of these and keeps its own line.

  **The line is still `### Fixed`, so it still only takes fixes against a released version.** This
  is where that is easiest to forget: the entry is already there, appending to it costs nothing, and
  a misaligned icon looks the same whether it shipped last month or was introduced this morning. It
  is not the same entry. Ask which released version had the crooked icon — no answer means the fix
  belongs to the unreleased line that introduced it, and nothing goes here. A release whose whole
  interface work was tidying up its own unreleased mistakes has no such line at all.
- **Refactors, CI, dependency bumps and internal cleanups stay out.** The git history is where
  those live. A version with genuinely nothing to tell users is released with `--no-notes`.

## Fixing something that is still unreleased

**A fix to an entry already sitting in `## [Unreleased]` is not a `### Fixed` entry.** That
feature has not shipped: nobody outside the repository ever saw the broken version, so a note about
repairing it describes a bug that never existed for them.

Edit the `Added` or `Changed` line it belongs to instead — or, when the line is still accurate, add
nothing at all. `### Fixed` is only for bugs a user of a released version could have run into.

The same test decides it every time: *which released version had this bug?* No answer means no
`Fixed` entry — including the shared interface-fix line at the foot of the section, which is a
`Fixed` entry like any other and is where the test is skipped most often.

## What the tooling expects

- `npm run notes` prints the commits since the last tag already grouped under these three headings
  — `feat` → Added, `fix` → Fixed, `perf`/`refactor`/`style` → Changed. That is a **draft**: it
  knows what was done, not which of it a user would notice. Edit it down.
- `###` headings are safe. Both
  [`scripts/set-version.mjs`](../../scripts/set-version.mjs) and
  [`.github/scripts/changelog-section.mjs`](../../.github/scripts/changelog-section.mjs) split the
  file on `## [` headings only, so the subheadings travel with their section into the release notes.
- `set-version` refuses to bump when `## [Unreleased]` is empty — but it only checks for text, so a
  heading left behind with nothing under it passes the check and ships as the release notes. Never
  stub the three headings out in advance; add each one with its first entry.

Released sections are never edited. See [docs/RELEASING.md](../../docs/RELEASING.md) for where the
notes go from here.

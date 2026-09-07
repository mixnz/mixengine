# Changelog

## Rules

- **One tag, one changelog entry, in order.** Update the changelog when a tag is cut, in that
  tag's own section. If a tag was missed, add its own section for it (in the right chronological
  place in the file) once the gap is found — never fold its entries into a later tag's section.
- **Three subheadings, always in this order:** `### Added`, `### Updated`, `### Fixed`. Omit a
  subheading only when it has no entries for that tag.
- **Read before writing.** Before adding an entry, read every commit on `master` since the last
  tag that already has a changelog section — `git log <last-changelog-tag>..HEAD` — so nothing
  gets skipped.

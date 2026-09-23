# Archived migrations

The 27 migrations that built `mixengine.db` during development. Before v0.0.7, the first release of
MixLab, they were folded into one file, `../migrations/0001_initial.sql`, and nothing runs these any
more. No database written by an earlier build is carried forward.

Read them for their history: each file's header explains why its change was made, and the new
`0001_initial.sql` keeps only a shorter version of those notes. They live outside `migrations/` on
purpose, because `sqlx::migrate!` embeds every file in that directory.

The folded schema matches what these files produce, with one deliberate difference. The CHECK on
`extensions.kind` no longer allows `'desktop-app'`, which `0024_no_desktop_app_extensions.sql` kept
only to avoid rebuilding the table.

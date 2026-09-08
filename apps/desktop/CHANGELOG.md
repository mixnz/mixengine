# Changelog

What changed in each released version of MixDB, newest first.

This file is written for the people who *use* MixDB, not for the people who write it. A change
belongs here if someone would notice it — a new feature, a different behaviour, a fixed bug.
Refactors, CI work and dependency bumps do not go here; the git history is where those live.

## How this file is kept

Work lands in `## [Unreleased]` **as it is finished**, not at release time. That is the whole
point of the file: by the time a version is cut, nobody remembers what went into it, and the notes
end up thinner and vaguer than the work deserved.

```bash
npm run notes            # list the commits since the last tag, grouped, as a starting draft
                         # -> edit into plain sentences under ## [Unreleased]
npm run set-version 0.1.0  # cuts ## [Unreleased] into ## [0.1.0] - <today> and opens a fresh one
```

Every entry sits under one of three headings — `### Added`, `### Changed`, `### Fixed` — and is one
short line. The bracketed version in each heading is a link, defined at the foot of the file; the
release script writes the new definition as it cuts a section, so there is nothing to remember. `Fixed` is for bugs in a *released* version: repairing something still sitting unreleased
above it means editing that entry, not adding a new one. The full rules, for whoever is writing:
[.agent/conventions/changelog.md](.agent/conventions/changelog.md).

From there the release workflow reads this file: the section for the version being tagged becomes
the `## Changes` part of the draft release body, which in turn becomes the update notes every
installed copy of MixDB is shown. So what is written here is what users read — see
[docs/RELEASING.md](docs/RELEASING.md).

**Released sections are not edited or deleted.** They are the record of what shipped in which
version, which is exactly what someone three versions behind needs when deciding whether to
update. The one exception is a release that is withdrawn: once it is gone from
[Releases](https://github.com/mixnz/mixdb/releases) nobody can install it, so its section here
would describe a version that no longer exists. The file grows by a handful of lines per release;
if it ever gets genuinely unwieldy, the oldest versions move to `docs/changelog/` and a link goes
at the bottom — the entries survive either way.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.33] - 2026-09-08

### Added

- Sites can switch the default web server serving them, with confirmation and rollback on failure.
- Sites gain an HTTP-to-HTTPS redirect option.
- Settings gains a Metrics screen with 24-hour CPU/RSS history, and a Dashboard panel for disk usage and cleanup.
- Settings gains root directory, managed TLDs, autostart, updates, doctor/repair, uninstall and a diagnostics bundle.

### Changed

- Uninstalling MixEngine now shows a confirmation dialog explaining what will be removed, instead of a "click again" prompt.
- Repairing browser trust for the local CA now asks for elevation in two steps instead of one.

### Fixed

- A failed runtime or package install now shows an error instead of silently clearing its progress bar.
- Applying an update no longer leaves Settings stuck on "will restart shortly" forever; the app now waits for the daemon to actually exit and offers a Start button.

## [0.0.32] - 2026-09-06

### Added

- Services can now be created and deleted, not just started, stopped or restarted.

### Changed

- The Runtimes screen's "Services" tab is renamed "Software" and split into sub-tabs by function (web servers, databases, cache & queues) instead of one flat list, so it no longer shares a name with the sidebar's own Services screen.
- The MixEngine Dashboard shows each service's state in your language and colours it, and start and stop share one button that reads the state it is in.
- A dropdown with nothing chosen yet shows its placeholder dimmed, so it reads as a prompt rather than as a value.
- The Runtimes screen's Languages/Software tabs, and the Software tab's web servers/databases/cache & queues tabs, stay visible at the top while their lists scroll, instead of scrolling out of view.

### Fixed

- Start, stop and restart in the MixEngine tab act on the service whose button was pressed. They were acting on every service at once.
- The MixEngine install link opens the Vietnamese page when the app language is Vietnamese, instead of always English.
- A runtime or package finishing its install now shows up in the installed list right away, instead of only after reopening the Runtimes tab.
- Installing or uninstalling a runtime or package no longer loses its progress bar if you switch to another MixEngine screen and back while it's still running.
- The Software tab's available-versions table shows the release channel, matching the Languages tab.
- Creating a project with "keep this project's services out of idle shutdown" checked no longer fails with a raw MixEngine error.
- The "MixEngine needs an administrator" dialog no longer dumps a certificate's raw bytes for a CA-trust request; it now just says how many.
- Spacing and layout-shift fixes in the Runtimes install-progress table, the Services/Logs empty-state message, the Dashboard's service table, the site form's services list, the tab strip, the tab error screen, and button labels that wrapped onto a second line in narrow rows.

## [0.0.31] - 2026-09-06

### Added

- A MixEngine tab: see the local daemon and the services it supervises, and start, stop or restart
  one.
- The MixEngine tab manages sites: create and edit them, share one on the LAN, and check domain
  DNS status, certificate authority trust and per-site certificates.
- SQL Server connections can be saved and connected, their tables read, their rows edited, added
  and deleted, hand-typed queries run in the Query tab, their databases, tables, columns and
  indexes created, changed and dropped from the Structure tab, and their databases dumped to a
  `.sql` file and restored back.

### Changed

- The connection form uses the full width of the pane. The fields keep the width they had; the
  database-kind row is the one that spreads, and scrolls sideways — fading at whichever end still
  has kinds behind it — instead of being cut off.
- MixDB is now dual-licensed under Apache-2.0 or MIT, instead of GPL-3.0-or-later.

## [0.0.30] - 2026-09-05

### Added

- SQLite: open a `.db` file — or make a new one — and browse, edit and query it like any other
  connection. Dump/Restore can now include row data, not just the schema, and the Structure tab can
  now change a column's type, `NOT NULL`, default or collation, not just its name.
- ClickHouse: the Data tab's grid can insert, update and delete rows, the Structure tab can create,
  rename and drop tables, databases and columns and manage data skipping indexes and the sorting
  key, the Query tab now takes `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` by hand, and Dump/Restore works
  like the other engines.
- MixDB now keeps a local error log and shows a recovery screen instead of a blank window when
  something goes wrong; open the log folder from Settings → Updates.

### Fixed

- File properties of the Windows app now show the publisher and copyright instead of blanks.
- The active tool's highlight in the Frequently used list now reaches the remove button instead of stopping short.
- A saved connection of a kind this version doesn't recognise (created by a newer version) no longer blanks the app on launch.

## [0.0.29] - 2026-09-04

### Added

- The Diff tool highlights the exact part that changed within a line, and can show the two sides
  side by side (Split) as well as the usual single-column view (Unified).
- The Tools sidebar has a search box, with a × to clear it, that filters tools without hiding
  their category headings.
- A Fake data generator tool seeds test rows from manually defined fields or a pasted JSON sample.
- A Radix converter tool reads a number in any base and shows it in binary, octal, decimal and hex.
- A Data masking tool blurs emails, phone numbers, names and other likely-sensitive columns in a
  pasted JSON or CSV sample before it gets shared.
- The Tools sidebar shows a "Frequently used" group, with whichever tools were opened most in the
  last 30 days, and a × on each entry to drop it back out of the group.
- A QR code tool turns pasted text into a QR code, with a choice of module style, colors and error
  correction, and a button to copy it as an image.

### Changed

- A `mixdb://` link opened from a browser no longer tries to connect without a password: the form
  opens filled in, with the caret in the password field.
- The app window opens smaller by default (1200x720).
- A new Tools tab opens with no tool selected, instead of jumping straight to the first one.

### Fixed

- A Tools tab's title now updates when the language is switched, instead of staying in the
  language it was opened in.

## [0.0.28] - 2026-09-03

### Added

- MixEngine can open one of its databases in MixDB: `mix database open` starts MixDB, or reaches
  the window already open, with the connection made and the password never on the command line
  or on disk.
- Only one MixDB window runs: starting it again brings the open one to the front.
- `mixdb://` links open MixDB with the connection filled in.

## [0.0.27] - 2026-09-03

### Changed

- New app icon: three coloured platters on a blue tile, drawn full size on Windows and Linux and with the Dock margin on macOS.

## [0.0.26] - 2026-08-29

### Changed

- A terminal tab is named after the saved target it was opened from, without turning the setting on
  first. The setting is still there to turn it off.

### Fixed

- The chosen database kind and connection method can be told from the others in the dark theme.

## [0.0.25] - 2026-08-29

### Changed

- The interface has been redrawn at a tool's density: sans for labels and menus, Fira Code kept for
  data, smaller type that fits about a quarter more rows, and a new default accent.

### Fixed

- The options of a long dropdown no longer flicker as the pointer moves over them.

## [0.0.24] - 2026-08-28

### Changed

- A dropdown fills in the option it is showing and opens with it in the middle of the list.

### Fixed

- Menus, dropdowns and tooltips are frosted again on macOS instead of being a clear film over the
  content behind them.
- Small interface fixes in the REST environment picker and method selector.

## [0.0.23] - 2026-08-28

### Fixed

- The listening ports tool no longer flashes a black console window on Windows.

## [0.0.22] - 2026-08-28

### Added

- Nine more tools: format & minify, data conversion, schema from JSON, `.env` conversion, diff, a
  regex tester, the ports listening on this machine, a cheatsheet of commands with fill-in
  parameters, and a connection string reader.

### Fixed

- Spacing and colour fixes in the REST request tables and the database connection sidebar.

## [0.0.21] - 2026-08-28

### Fixed

- macOS asks for permission to read saved passwords once after an update, not once for every saved
  connection. Ten connections used to mean ten Keychain dialogs at once on opening the Database
  tab; the first run after this update still asks for each of them, and no run after that does.

## [0.0.20] - 2026-08-28

### Added

- Tools: a fourth kind of tab, holding a SQL-to-MongoDB translator, a timestamp converter,
  encode/hash, a JWT decoder, a bulk id generator and a case converter.
- Terminal settings: name a tab after its saved target instead of `user@host` or the shell.

### Changed

- The saved connection the form is holding is scrolled into view in the list beside it.
- Tab strips scroll sideways under the wheel, with an arrow at each end where tabs are hidden. The
  MixDB button stays put instead of scrolling away, `[+]` is held at the right edge once the tabs
  run past it, and the scrollbar is gone.

## [0.0.19] - 2026-08-28

### Added

- A dump or restore can be stopped while it runs.

### Fixed

- Enter no longer confirms a dialog that deletes something; it now cancels, like Escape.
- MixDB starts faster: a tab's workspace is now loaded when it is first opened rather than all three at launch.
- A session too large to store no longer crashes the window; the previous one is kept instead.
- Closing a REST tab while a request is in flight now cancels it, instead of leaving it running to its timeout.
- A tool download interrupted by a crash no longer leaves hundreds of megabytes behind; MixDB now clears it on the next start.
- A database whose name starts with `-`, or contains `=`, can now be dumped and restored; on PostgreSQL such a name could send the tool to another server entirely.
- The SSH host keys MixDB has seen are no longer lost if it is interrupted while writing them down.
- Opening a terminal, or checking which dump tools are installed, no longer briefly freezes the rest of the app.
- Closing a database tab during a dump or restore now stops the tool, instead of leaving it running to the end.
- In the dark theme, the red on delete buttons, invalid cells and failure notices is now the readable one the rest of the app already used.
- Tab now stays inside an open dialog, and focus returns where it was when the dialog closes.
- A right-click menu can now be walked with the arrow keys.
- Errors and loading notices are now announced by screen readers.
- An error raised after you switch language now appears in the language you switched to.
- Loading a Mongo or Redis connection and then switching the form to MySQL no longer ticks TLS by itself.
- A request timeout of 0 now means no limit, instead of failing the request instantly.
- A response header whose value is not plain ASCII is no longer shown as empty.
- Query checks on PostgreSQL are no longer labelled as coming from MySQL.
- Cancelling a query that had already finished no longer reports an error on a server that answers in another language.
- A tab named after its connection now says PostgreSQL rather than `postgres`.
- Duplicating a connection now names the copy in your own language.
- Query history on an unsaved connection no longer fills up with runs nothing can show or clear.
- Disconnecting now closes the connection properly rather than leaving the server to notice it vanished.
- The app's own tab bar can now be reached and used from the keyboard, like every other strip.
- One unreadable saved terminal target no longer empties the whole saved list for the session.
- Switching database no longer leaves the previous one's tables, collections or error on screen.
- Loading more keys in Redis after switching database no longer appends the old database's keys.
- An error from a table you have already moved away from is no longer shown against the table now open.
- Pasting a cURL command no longer reads a filename such as `cookies.txt` as the address.
- Pasted `--json` and `--data-urlencode` commands now bring their body across instead of arriving empty.
- Closing a tab while it is being dragged no longer leaves MixDB working on every frame for the rest of the session.
- “Check now” no longer throws away an update already downloaded and waiting for the restart.
- The update dot and its panel no longer blink off while a re-check is running.
- Escape now closes only the dropdown it was pressed on, instead of also closing the dialog around it and losing the form.
- One dropped connection through an SSH tunnel no longer takes the whole tunnel down with it, silently, for the rest of the session.
- A PostgreSQL script is no longer cut in half at an `E'...'` string, which sent broken halves to the server.
- A PostgreSQL name holding a `$`, such as `a$b$c`, no longer swallows the rest of the script.
- Closing a database tab while it is still connecting now closes the connection it was opening.
- Pressing Connect twice no longer opens a second connection that stays open for the rest of the session.
- Closing a terminal tab while it is still connecting now closes the session it was opening, instead of leaving it running.
- An SSH tab whose shell has exited now closes the connection to the server instead of holding it open until MixDB quits.
- A script that leaves a transaction open no longer breaks the tables list and the table data beside it.
- A read-only connection now refuses `EXPLAIN ANALYZE`, which runs the statement it explains rather than only planning it.
- The response Preview's *Run scripts* and *Load external resources* switches now work in the
  installed app, not only in a development build.
- An image response shows again in the Preview tab.

## [0.0.18] - 2026-08-27

### Added

- Anything a terminal tab opens can be saved now — a shell on this machine as well as an SSH server — in one list.
- A saved terminal target carries the commands to run the moment you land: `cd ~/project-a/frontend`, `nvm use`.
- Save as new turns a saved terminal target into a variant of itself without touching the original.
- Ctrl/Cmd+click a link in the terminal to open it in your browser. http and https only.
- The REST response Preview can run the page's own scripts — a switch beside it, off every time the pane is drawn.

### Changed

- Update in the terminal's target form is dead until something in the form actually differs from what was saved.

### Fixed

- A database tab that was left at the connection form comes back to that same connection, loaded and marked in the list, instead of reopening blank under the name of it.
- Leaving a terminal session comes back to the form with the saved target still loaded and named, instead of an empty Name box.

## [0.0.17] - 2026-08-27

### Added

- A Disconnect button at the end of a connection's tabs closes it and brings the connection form back, still on the connection you left.
- Ctrl/Cmd+R reloads a Redis connection: the key list, or the open key's value once you are reading one.

### Changed

- A REST tab is called REST and wears the globe, instead of taking the name of whichever request is open in it.
- Every tab on the tab bar carries a mark: its module's icon until it has one of its own, which a new tab and one restored from the last session did not.

### Fixed

- Letting go of a tab you have dragged no longer opens it as well.
- A short tab drags past longer ones, instead of only swapping with tabs about its own width.
- The requests on a REST tab's strip no longer slide out from the left edge each time you come back to the tab.
- Liquid glass menus, tooltips and toasts are less see-through, noticeably so on macOS.

## [0.0.16] - 2026-08-23

### Added

- Results in the Query tab sort by clicking a column heading, and a filter box narrows them to the rows holding what you type.
- Result rows can be selected and copied as TSV, CSV or JSON, from the keyboard or the right-click menu.
- Double-clicking a result cell opens it in a dialog, with JSON coloured.
- A script of several statements says how many of them ran and how long the server spent on them.
- Rows in the Data tab copy as JSON as well as TSV and CSV, and Ctrl/Cmd+C copies the selected ones.
- A cell of the Data tab's table opens in a dialog, the same one the Query tab's results use.
- Right-clicking a column heading in the Data tab copies the column name.
- Tabs come back to what they had open — a saved connection, the requests on a REST strip, a local shell or saved host — the first time you click them after a restart.
- Tabs drag into any order, on the app's tab bar and on the REST tab's request strip.
- The middle mouse button closes a tab on the app's tab bar, as it already did on the REST tab's request strip.

### Changed

- Right-clicking text you have selected now offers the usual Copy menu instead of nothing.

### Fixed

- Dragging the divider in the Query tab all the way up no longer pushes the bar at the foot of the tab off the screen.
- The Query tab's Expand and Hide buttons no longer contradict each other: results that are put away cannot be lifted, and results over the window cannot be put away from behind them.
- Double-clicking a column name in the Structure tab no longer takes the PK, IX or AI badge beside it along with the name.

## [0.0.15] - 2026-08-22

### Added

- Ctrl/Cmd+R sends the open REST request, the same as Ctrl/Cmd+Enter.

### Fixed

- Opening a terminal tab on Windows no longer flashes up a console window.

## [0.0.14] - 2026-08-22

### Added

- A Terminal tab opens a shell on this machine — PowerShell, Command Prompt, Git Bash, WSL, your login shell — or on a server over SSH, with saved hosts whose passwords stay in the OS credential store.
- A connection over an SSH tunnel now heals itself: the tunnel keeps its session alive and opens a new one behind the same local port when it drops.
- The REST client keeps a history of everything it sent, and takes its timeout, redirect and certificate settings from a pane of its own.
- REST requests take `{{variables}}` from an environment picked at the end of the tab strip, with values marked secret kept in the OS credential store instead of on disk.
- REST requests carry credentials: a bearer token, basic auth, or an API key sent as a header or a query parameter.
- REST bodies can now be a form, a multipart upload with files from disk, or a single file sent as it is.
- A connection that dropped now says so plainly instead of repeating the driver's own words about bytes at EOF.
- A read that died with the connection is run again once, after the tunnel has been opened back up. Writes are never repeated.
- A tunnel that dropped holds its own tab until it is back, offering to try again or to disconnect.
- Ctrl+Tab moves to the next tab and Ctrl+Shift+Tab to the previous one, wrapping round both ends.
- MixDB reopens with the tabs that were on the strip when it was last closed. Only the tab that was active comes back open; the rest wait until you pick them.

### Changed

- Settings lists the database module's pane as **Database**, beside REST and Terminal. The dump tools are a heading inside it.

## [0.0.13] - 2026-08-19

### Added

- REST client tabs: compose a request, send it, and read the response as a preview, a tree or raw bytes.
- Pasting a cURL command into a REST tab fills a request in — method, URL, headers and body — and right-clicking a request copies it back out as one.
- Pasted REST requests collect in the sidebar's Recent group, which holds ten and can pin one to Saved.
- Settings has a Shortcuts pane listing every Ctrl/Cmd shortcut in the app.
- Ctrl/Cmd+1 opens a Database tab and Ctrl/Cmd+2 a REST tab.

## [0.0.12] - 2026-08-15

### Added

- The Structure tab searches a table's columns by name.
- The Statistics tab searches a database's tables by name, and totals what the search leaves.

### Changed

- The Structure tab marks a default the server evaluates, such as `uuid()`, with an `f(x)` badge, so it no longer reads as stored text.

### Fixed

- Dumping a MariaDB database no longer fails as soon as it starts.
- Column defaults read correctly on MariaDB, which showed them quoted and made every nullable column look as though it defaulted to NULL.
- MariaDB's `uca1400_*` collations say which character sets they cover instead of showing a blank.
- A new row on MariaDB no longer stores the text of an expression default, such as `uuid()`, as the value itself.
- A `varchar` column left with an empty length box is created with the 255 the box suggests, instead of refusing to save.

## [0.0.11] - 2026-08-14

### Added

- Connect to PostgreSQL: browse and edit its rows, change tables and indexes, run queries with completion, and dump or restore with pg_dump and psql — which MixDB can now download for you on Windows and macOS, or find wherever PostgreSQL is already installed.

### Changed

- Saved connections, the connection form and the open tabs show each engine's own logo instead of a lettered badge.

## [0.0.10] - 2026-08-13

### Added

- A right-click menu on MySQL rows: copy a cell, copy the selected rows as `INSERT` statements, as
  TSV or as CSV, follow a foreign key to the row it points at, and reload.
  Following a key leaves the table search alone and pins the table it opened at the top of the
  list, until another table is chosen.
- A Redis connection to another machine with no password now warns that the server's protected mode
  will refuse it, instead of leaving you with "Redis: broken pipe".
- `Ctrl+F` on a MySQL table puts the caret in the filter bar's first value box, adding a row if
  there is none.
- Settings › Appearance can turn the layers that float over your data — menus, dropdowns, tooltips,
  the update toast, the loading pill and the dialogs — to liquid glass, which frosts and bends what
  is behind them. A grid's pinned header and totals frost the rows sliding under them, and the page,
  the tab bar and the controls take the same material. Off by default.
- Opening a MySQL or MongoDB database puts the caret in the sidebar's search box, and `↓` from there
  hands the keyboard to the list: the arrows walk the tables or collections, Enter opens the one they
  are on, and `↑` off the top row goes back to the search box.

### Changed

- Marking a connection read-only now works for every kind, not only MySQL. On MongoDB the
  collections cannot be created, renamed or dropped, the dump tools are closed, and documents
  neither open for editing nor take an insert, a clone or a delete; on Redis, keys cannot be
  deleted from either the value pane or a group. Everything that reads works as before.
- A MySQL table opens where you left it — same page, order, filters, scroll and rows — as do its
  structure and its database's statistics. Only a reload, `Ctrl+R`, or a change you made yourself
  asks the server again, and a change to one table costs only that table.
- MongoDB works the same way: a collection opens on the page, filters and scroll it was left at,
  and the Statistics tab keeps what it read for each database. Moving to the Statistics tab and
  back no longer re-reads the documents. Creating, renaming or dropping a collection does.
- A `CREATE`, `ALTER` or `DROP` run in the Query tab refreshes the table list and the other tabs
  with it, the same as making the change from the sidebar.
- Inserting or deleting rows or documents moves the statistics too.
- A right-click no longer opens the browser's own menu. The app's menus, and cut, copy and paste in
  a text field, are unchanged.
- A right-click menu no longer holds the rest of the window: the click that dismisses it also does
  what it was aimed at, and scrolling closes it.
- `Ctrl+A` on a MySQL table's Data tab selects every row on the page without clicking the grid
  first. In a text box it still selects the text.
- A MySQL table now shows 1000 rows a page by default, and 5000 is offered alongside the other
  sizes.
- Tab reaches a sidebar list as one stop rather than one per table or collection; the arrows walk
  it from there.
- Reloading a MySQL table or a MongoDB collection goes back to the top of the first page. An insert
  or a delete still refetches the page it was made on.

### Fixed

- On macOS every shortcut is now `⌘` rather than `Ctrl` — reload, new and close tab, select all,
  format, and click-to-open in the Query tab — leaving `Ctrl+Click` to the context menu it has
  always opened. Shortcuts on screen are written the way the platform writes them.
- Scrolling the Query tab sideways no longer runs the script over its own line numbers.
- Colour and edge fixes in the MySQL Data grid, whose rules were drawn in a fixed light grey that
  stayed light on the dark theme, and whose frame had square corners.

## [0.0.9] - 2026-08-12

### Added

- The MySQL dump tools can now be downloaded on macOS and on Linux x86-64, not only on Windows.

### Changed

- Where there is no download to be had — Linux on ARM — the Download button is replaced by a line
  saying to install mysql-client from the package manager, rather than failing when pressed.

## [0.0.8] - 2026-08-12

### Changed

- A `SELECT` written without a `LIMIT` of its own is now sent with a ceiling of ten thousand rows
  rather than five hundred, and that ceiling is no longer a setting.
- Moving between a connection's tabs no longer re-reads anything: Data comes back to the page,
  filters and selection it was left on, and Structure to the columns and indexes it had.
- Dialogs, menus and tooltips now fade in and out instead of appearing and vanishing outright.
- A connection marked read-only now says so before you touch anything: its row in the connection
  list carries a Read-only badge, and once it is open, its tab shows a lock and an amber bar along
  the top in place of the usual accent.
- The wait shown over a panel that is loading is now a larger pill with a turning ring, rather than
  a small grey line easily taken for part of the table under it.

### Fixed

- A grid of more than a few dozen rows no longer slows the app down — the Query tab's results, the
  Data tab, Structure and Statistics each build only the rows on screen, so ten thousand rows cost
  what a screenful costs. Selecting, sorting and editing in place work exactly as before.
- The Query tab's results no longer show a scrollbar when the one result in the column already
  fits.
- The update panel now lists what a new version changed, instead of showing the word "Added".

## [0.0.7] - 2026-08-11

### Added

- The Query tab has a bar along its bottom edge. Expand lifts the whole results pane out over the
  window — a script of several SELECTs no longer gives each of them a quarter of an already short
  pane — and Escape, the close button or a click outside puts it back. The button beside it puts the
  results away to get the window back for the script, and running again brings them up.
- A single run can be dropped from the Query tab's History, rather than only clearing the lot: the
  failed attempts a working query leaves behind it can go without taking the query with them.

### Changed

- `Ctrl+R` now acts on the pane you are looking at instead of reloading MixDB and dropping every
  open connection with it: it reloads MySQL's Data and Structure tabs, MongoDB's documents and the
  Statistics tab, and runs the script in the Query tab. `Ctrl+Shift+R` and `F5` do nothing.
- The Query tab has a single Run button. It runs the selected text, or the whole script when
  nothing is selected — `Ctrl+Enter`, `Ctrl+Shift+Enter` and the Run all button are gone.
- The Query tab keeps the whole window for the script until a run has something to show, and then
  the results rise into place under it. The line between the two is dragged to give either one more
  room, in place of the editor's own resize corner.

### Fixed

- A result shortened by an added `LIMIT` no longer has the bottom of its first table cut off. The
  line saying the limit was added sat inside the scrolling results and pushed them down past the
  bottom edge.
- Spacing and alignment fixes in the buttons that carry an icon beside their label.

## [0.0.6] - 2026-08-11

### Added

- The Query tab is a real SQL editor: MySQL syntax coloured as it is typed, matched brackets and
  quotes, line numbers, `Ctrl+F` to search and replace, and a Format button (`Ctrl+Shift+F`).
- Table and column names complete from the database itself — tables after `FROM` and `JOIN`,
  columns of the tables in the statement, aliases and all, with types and foreign-key targets
  beside them — alongside keywords, MySQL's functions and your saved queries.
- `Ctrl+Enter` runs the statement the caret is in, marked in the margin; `Ctrl+Shift+Enter` runs
  the whole script; a selection runs exactly the selection.
- The script is checked as it is written: an unclosed quote or bracket in red, a name the database
  has never heard of in amber with the closest real one as a one-press fix, and MySQL's own words
  about the statement being typed against the line it named. `F8` walks the problems.
- Resting the pointer on a name says what it is — a table's columns, a column's type and keys, a
  function's signature — and `Ctrl+Click` a table name opens its rows.
- An `UPDATE`, `DELETE` or `TRUNCATE` that says nothing about which rows asks first, as does a
  `DROP` or an `ALTER` that drops a column, partition or key. A statement opening with `WITH` is
  judged by what it leads into.
- A `SELECT` written without a `LIMIT` is sent with one — five hundred rows by default, changeable
  in Settings and switchable off. Your own `LIMIT` and locking reads are left alone.
- A saved connection can be marked read-only from the sidebar's right-click menu, and then nothing
  in the workspace will change the server: the Query tab refuses anything but a read and says which
  word it stopped at, and editing, dumps, restores and structure changes are closed. It is a
  reminder about which server this is, not a permission.
- The Query tab keeps its script per connection and database, remembers what has been run in a
  searchable History, and saves queries under a name in Snippets.
- Redis: right-clicking a group in the key sidebar offers "List keys to delete" — the keys under
  that prefix open on the right with a tickbox each, a filter box and a Delete button.
- Redis: a key limit picker beside the grouping character says how much of the keyspace to read
  before the scan stops, remembered per connection.
- A saved connection can be pinned from the sidebar's right-click menu and is held at the top.

### Changed

- The connection list is ordered by name, pinned first. Accented names file beside their plain
  spelling, and `db2` comes before `db10`.
- The connection form is drawn at the app's own control size, so it takes noticeably less height.
- The SSH tunnel test answers in colour, and its button stays disabled until the host, the user and
  the chosen auth method's credential have been filled in.
- Everything through an SSH tunnel moves faster — dumps and restores most visibly. The forward now
  carries both directions at once, in much larger pieces, and sends each the moment it has it.
- Redis: the key sidebar reads the whole keyspace up front instead of a page per press of Load
  more, so the sorted list only ever grows downwards. Its footer stays at the bottom, says how many
  keys have been read, and marks folder counts `12+` while a scan is still running.
- A mouse wheel spun quickly carries up to four times as far, and a pause drops straight back to a
  single notch. Touchpads scroll as they always did.

### Fixed

- Typing in the Query tab is no longer slow once a large result is on screen. The grid is redrawn
  when the results change, not when the script does.
- Running a script that holds nothing but comments says so, instead of leaving the results blank.
- Saving, renaming or deleting a connection in one tab now shows in every other open tab.
- A new connection tab no longer opens with a narrow sidebar that widens a beat later and shoves
  the form sideways.
- Updating a saved connection keeps the rest of what is remembered about it — whether it is pinned,
  the sidebar width, Redis's key limit.
- The filter bar keeps its conditions through a trip to the Structure, Stats or Query tab.

## [0.0.5] - 2026-08-10

### Added

- The window opens at 1280×800 and remembers whether it was left maximized.

### Fixed

- Update notes written on a published release are now copied into the manifest the updater reads.
  Before this, the panel in the corner of the app described every update with a placeholder.

## [0.0.4] - 2026-08-10

First published release. MySQL, MongoDB and Redis connections, optionally through an SSH tunnel,
with saved connections kept in the OS credential store rather than in a file.

MixDB updates itself from here on: it downloads a new version in the background, asks, then
installs it and restarts. Every update is checked against MixDB's signing key first.

<!-- Where each version's heading points, which is what makes the bracketed names above
     links rather than decoration. `set-version.mjs` adds a line here as it cuts a section,
     so this stays in step without anyone remembering it. -->

[Unreleased]: https://github.com/mixnz/mixdb/compare/v0.0.33...HEAD
[0.0.33]: https://github.com/mixnz/mixdb/compare/v0.0.32...v0.0.33
[0.0.32]: https://github.com/mixnz/mixdb/compare/v0.0.31...v0.0.32
[0.0.31]: https://github.com/mixnz/mixdb/compare/v0.0.30...v0.0.31
[0.0.30]: https://github.com/mixnz/mixdb/compare/v0.0.29...v0.0.30
[0.0.29]: https://github.com/mixnz/mixdb/compare/v0.0.28...v0.0.29
[0.0.28]: https://github.com/mixnz/mixdb/compare/v0.0.27...v0.0.28
[0.0.27]: https://github.com/mixnz/mixdb/compare/v0.0.26...v0.0.27
[0.0.26]: https://github.com/mixnz/mixdb/compare/v0.0.25...v0.0.26
[0.0.25]: https://github.com/mixnz/mixdb/compare/v0.0.24...v0.0.25
[0.0.24]: https://github.com/mixnz/mixdb/compare/v0.0.23...v0.0.24
[0.0.23]: https://github.com/mixnz/mixdb/compare/v0.0.22...v0.0.23
[0.0.22]: https://github.com/mixnz/mixdb/compare/v0.0.21...v0.0.22
[0.0.21]: https://github.com/mixnz/mixdb/compare/v0.0.20...v0.0.21
[0.0.20]: https://github.com/mixnz/mixdb/compare/v0.0.19...v0.0.20
[0.0.19]: https://github.com/mixnz/mixdb/compare/v0.0.18...v0.0.19
[0.0.18]: https://github.com/mixnz/mixdb/compare/v0.0.17...v0.0.18
[0.0.17]: https://github.com/mixnz/mixdb/compare/v0.0.16...v0.0.17
[0.0.16]: https://github.com/mixnz/mixdb/compare/v0.0.15...v0.0.16
[0.0.15]: https://github.com/mixnz/mixdb/compare/v0.0.14...v0.0.15
[0.0.14]: https://github.com/mixnz/mixdb/compare/v0.0.13...v0.0.14
[0.0.13]: https://github.com/mixnz/mixdb/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/mixnz/mixdb/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/mixnz/mixdb/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/mixnz/mixdb/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/mixnz/mixdb/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/mixnz/mixdb/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/mixnz/mixdb/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/mixnz/mixdb/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/mixnz/mixdb/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/mixnz/mixdb/releases/tag/v0.0.4

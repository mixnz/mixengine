# Changelog

## Unreleased

### Added
- `mix service autostart <service> --on|--off` reads and sets whether a service starts with
  MixEngine, and `mix service list` has an `AUTOSTART` column.
- MixLab's first launch brings a MixDB user's saved connections, hosts, environments, drafts and
  their passwords across — once, leaving the MixDB install and its credentials untouched.
- MixLab asks on first run what it will be used for — MixEngine alone, everything, or the database
  tools — and Settings has a Modules pane that changes the answer. Turning a module off closes its
  tabs and hides it; nothing saved is deleted, and turning it back on finds it where it was.

### Changed
- The desktop window is **MixLab**: its own name, identifier, executable and mark, and MixEngine's
  version rather than one of its own. The daemon, `mix`, the home, the keyring namespace and the
  installers keep MixEngine's name and are unchanged.
- MixLab's tab menu and its `Ctrl/Cmd+1 … N` shortcuts lead with MixEngine, and the number keys
  count across the modules you have turned on rather than across all five.
- A new MixLab tab opens whichever module your profile leads with — the MixEngine dashboard for
  *MixEngine* and *Everything*, a database connection for *Database tools* — so `Ctrl/Cmd+T` no
  longer always opens the database client. What was open when you last closed the window is
  restored first, as before.
- When MixLab cannot find `mixengined` beside itself, the MixEngine tab now lists the directories it
  looked in and offers to reinstall MixEngine, instead of inviting a first install.
- With the database client turned off, MixLab's Services screen offers rather than acts: *open* on
  a database service says it will turn the client on first, and offers another installed database
  application where MixEngine found one. A `mixdb://` link or `mix database open` turns the client
  on for the tab it opens, and the tab says so.

## v0.0.6

### Added
- Opt-in per-site HTTP → HTTPS redirect (`--https-redirect` on `site create`/`site update`), off by
  default; answers with a `307` so a site can turn it back off.

### Updated
- Signed-document clients (runtimes, updates, extension registry, RPC) now share one HTTP
  transport instead of building one each, cutting the daemon's idle memory footprint.

### Fixed
- The missing-helper hint now matches how each install format actually ships
  `mixengine-elevate`, instead of assuming every release keeps a copy beside `mixengined`.
- MariaDB starts from a certificate issued once by this home's own authority instead of
  generating a new key at every start, cutting several seconds off every warm start.

## v0.0.5

### Fixed
- probe the helper only after a batch that could have replaced it, and settle two flaky gates

## v0.0.4

- Every .tar.zst and .tar.gz we publish begins with the ./ entry tar writes,
  and the path check read it as one escaping the destination — no runtime or
  package could install on macOS or Linux. The unpackers now skip an entry
  that names the destination itself; safe() and the traversal guard are
  unchanged.

## v0.0.3

- `feat(disk)`: disk usage by category plus a cleanup that only reaches what is safe to lose (`mix disk`, `mix cleanup`).
- `fix(mysql)`: MySQL 5.7 now starts on Windows (`--shared-memory`); daemon waits for a leaving lock holder instead of racing it.
- `fix(runtimes)`: correct the Windows DLL file name for a generated extension line.

## v0.0.2

- `docs(guide)`: rewrite the Vietnamese handbook, point every page at MixDB.
- `fix(release)`: correct version literals left behind by the 0.1.0 rename.

## v0.0.1

MixEngine is a local web development environment: run and switch multiple PHP,
Node.js, Python and Ruby versions, plus bundled Nginx/Caddy and MariaDB/MySQL/PostgreSQL/Redis/
Memcached, local domains with automatic HTTPS — without Docker, without hand-written config files.

Note: this will be the first release. Scope and timeline are still under discussion; not finalized.

Nothing is code-signed or notarised, by design: expect SmartScreen on Windows and Gatekeeper's
"Open Anyway" on macOS. A machine with Smart App Control enforcing is not supported. On ARM64
Windows some runtimes have no build of their own and run under emulation, marked `emulated` in
`mix runtime available`.

## 0.0.1-beta.2 — unreleased

Updates on top of beta.1:

- `mix database credentials` reads a stored password back, and `--password` on `mix database
  create` lets you choose one instead of generating it.
- `--refresh` on `mix runtime available`, `mix package available` and `mix extension available`
  bypasses the registry's six-hour cache and asks again immediately.
- A build that did not come out of the packaging pipeline (a local `cargo run`) now keeps its own
  `MixEngine-dev` home instead of touching the real release home and its database.
- A daemon that fails to start now says why, instead of leaving you to guess.
- One-off child processes on Windows start without a stray console window.
- The installer's final rename gets a longer window so a scanner locking the file doesn't fail it.
- Install docs link to each OS's latest release automatically instead of naming a version.

Nothing is code-signed or notarised, by design: expect SmartScreen on Windows and Gatekeeper's
"Open Anyway" on macOS. A machine with Smart App Control enforcing is not supported. On ARM64
Windows some runtimes have no build of their own and run under emulation, marked `emulated` in
`mix runtime available`.

## 0.0.1-beta.1 — unreleased

The first public beta.

- PHP 7.0+, Node.js 16+, Python 3.10+ and Ruby 3.2+, one immutable directory per version, chosen
  per directory with no shell hook and nothing to activate.
- Caddy, nginx, php-fpm, MariaDB, MySQL, PostgreSQL, Redis and Memcached, run from generated
  configuration that is regenerated rather than edited.
- `http://blog.test` and trusted HTTPS with no prompts after first-run setup; LAN sharing,
  blueprints, extensions and `mix doctor`.
- Installers for six OS/arch targets, a signature-verified `mix self-update`, a handbook in English
  and Vietnamese, and a published TypeScript API contract for clients.

A MixEngine built from source keeps its own home directory (`MixEngine-dev`), so a working tree
cannot migrate the database a released MixEngine is using.

Nothing is code-signed or notarised, by design: expect SmartScreen on Windows and Gatekeeper's
"Open Anyway" on macOS. A machine with Smart App Control enforcing is not supported. On ARM64
Windows some runtimes have no build of their own and run under emulation, marked `emulated` in
`mix runtime available`.

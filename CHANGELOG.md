# Changelog

## Unreleased

### Added
- Every tab of MixLab's Runtimes screen has a search box over the versions not installed yet, so a
  long list of releases can be narrowed by name, version or channel.
- `mix service autostart <service> --on|--off` reads and sets whether a service starts with
  MixEngine, and `mix service list` has an `AUTOSTART` column.
- Services set that way now start when MixEngine does, in dependency order — so a machine that was
  restarted comes back with the same things running, without anybody starting them by hand.
- MixLab's Services screen has that switch, beside the idle timeout, and its Dashboard has an
  Autostart column — so what comes back after a reboot is visible without opening anything.
- `mix blueprint apply --with-front-end` installs a web server too where the machine has none, so a
  blueprint with a site no longer ends with a site nothing serves. A machine that already has one —
  Caddy or nginx — is left alone.
- `mix blueprint apply --autostart` marks the services it creates to start with MixEngine. Services
  the apply found already there keep whatever their owner set.
- MixLab's Dashboard offers to build your first site while the machine has none: pick a stack, name
  it, and one button installs, configures and starts everything it needs, then hands you its
  address.
- Applying a blueprint in MixLab now ends where the project does: it spends the elevation prompt,
  starts what this home declares, and names the address of the site it made with a button to open
  it. Before, an apply from the Blueprints screen stopped at a list of steps.
- MixLab says what leaving the `[scaffold]` consent box unticked will mean *before* the apply runs —
  the button reads *Set up without running the command*, and the finished apply says the project
  folder is still empty and prints the command you can run yourself. It used to be one line among
  ten, after the fact.
- `mix blueprint apply --start` starts this home's services once the apply is done, after the one
  elevation prompt rather than before it.
- MixLab's first launch brings a MixDB user's saved connections, hosts, environments, drafts and
  their passwords across — once, leaving the MixDB install and its credentials untouched.
- MixLab asks on first run what it will be used for — MixEngine alone, everything, or the database
  tools — and Settings has a Modules pane that changes the answer. Turning a module off closes its
  tabs and hides it; nothing saved is deleted, and turning it back on finds it where it was.

### Fixed
- Applying the Next.js blueprint no longer fails on the last step over an empty folder. A project
  named `Next.js 1` now gets the directory `next-js-1`, because `create-next-app` takes its package
  name from the folder it is run in and npm refuses capitals and spaces. A folder you name yourself
  is still used exactly as you spelled it.
- A scaffold command that fails says so in a sentence you can read: colour codes from tools like
  `create-next-app` no longer arrive as `[31m` in the middle of the message, and a multi-line
  explanation keeps its lines instead of being run together with slashes.
- A site whose PHP pool is not running now starts it from the request that needed it, whatever left
  it stopped. Before, only a pool the idle sweeper had stopped could be woken — so after a reboot or
  a `mix daemon restart` every PHP site on the machine answered 502 until somebody ran `mix service
  start` by hand. A service you stopped yourself is still left alone.

### Changed
- MixLab's *Build your first site* card asks where to **put** the project rather than which folder
  is the project: pick a parent, and MixEngine makes and names the folder inside it. The name it
  chooses is shown in the plan before anything is created.
- MixLab stops offering a second MixEngine tab: one tab is the whole of it, so a window showing
  MixEngine alone has no `[+]` button, and `Ctrl/Cmd+1` goes to the tab rather than opening another.
  The close button on the last tab there is now reads *Reload module* — closing it puts a fresh one
  in its place, which is how a module is reloaded.
- MixLab's Runtimes screen puts Web servers, Databases and Cache & queues on the same tab strip as
  Languages: one row of tabs instead of a *Software* tab that had to be opened first.
- MixLab wears MixDB's mark — three data platters fanned out on a blue tile — in the taskbar, the
  Dock, the window and the browser tab.
- Every checkbox in MixLab is drawn by the app rather than by the operating system: one box, one
  tick, the accent you picked, and a half-tick where a list is only partly selected.
- MixLab has a **PHP Extensions** screen: pick an installed PHP and turn `redis`, `mongodb`,
  `xdebug` and the rest on or off. The same panel is still inside Runtimes, and MixEngine's own
  add-ons are now labelled *Add-ons* so the two stop colliding.
- MixLab's MixEngine sidebar is grouped into Overview, Websites, Environment and Library, with
  Settings at the bottom. Each group name now reads as a heading rather than as one more entry: a
  rule above it, and dimmed type that no longer borrowed the colour of the items below it.
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
- Creating a site now says which service is missing instead of answering `FOREIGN KEY constraint
  failed`, and a `php-fpm` pool that was deleted while its PHP stayed installed is made again where
  the need is found — before, deleting that service left every new PHP site on the machine failing
  until the daemon was restarted.
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

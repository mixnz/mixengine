# T130–T134 — What a terminal inherits

**Date**: 2026-09-15
**Status**: accepted
**Roadmap**: phase 15, tasks T130–T134
**Decision records this asks for**: `0033-bin-is-a-projection-of-what-is-installed.md`,
`0034-mixengines-authority-reaches-a-runtime-through-a-generated-bundle.md`

---

## The three complaints

Three sentences from somebody using the finished product. They arrived separately and they are one
spec, because all three are the same question asked three ways: **what does a terminal inherit from
MixEngine?** Today the answer is nineteen file names and two environment variables, and each
complaint is a different edge of that answer being too small.

> 1. `bin` thiếu `mysql`, `mysqldump`, … các bin của database, redis, …
> 2. `npm -g install yarn`, sau đó lệnh `yarn` không gọi được
> 3. nodejs app, call https từ 1 site của mixengine báo lỗi
>    `FetchError: request to https://ezweb.test/customize/js failed, reason: unable to verify the
>    first certificate`. website này lúc đó vẫn mở trên trình duyệt bình thường

### Complaint 1 — the database and cache clients are not commands

`shims::COMMANDS` (`crates/mixengine-core/src/shims.rs`) is a **compile-time constant** holding the
commands of the four languages and Composer. `shims::refresh` copies the shim binary once per row
and **removes everything in `bin/` that no row names**. So `bin/` holds exactly nineteen files, and
nothing a database ships is among them.

The data is not missing — only the projection is. Every service package records its executables in
`packages.provides_json` at install time, and the maps on the reference machine are complete:

| Package | `provides` keys |
| --- | --- |
| mariadb 12.3.2 | `mariadb`, `mariadb-admin`, `mariadb-backup`, `mariadb-dump`, `mariadb-install-db`, `mariadb-upgrade`, `mariadbd` |
| mysql 5.7.44 | `mysql`, `mysqladmin`, `mysqlbinlog`, `mysqlcheck`, `mysqldump`, `mysqlimport`, `mysqlpump`, `mysqlshow`, `mysqlslap`, `mysql_upgrade`, `my_print_defaults`, `mysqld` |
| postgres 18.6 | `psql`, `pg_dump`, `pg_dumpall`, `pg_restore`, `pg_isready`, `createdb`, `dropdb`, `createuser`, `reindexdb`, `vacuumdb`, `pg_basebackup`, `pg_upgrade`, `initdb`, `pg_ctl`, `postgres` |
| redis 8.10.0 | `redis-cli`, `redis-check-aof`, `redis-check-rdb`, `redis-server` |

What stops a row being added to `COMMANDS` for each of them is that **a service has no version
resolution**. A runtime resolves per directory — `resolve::runtime` walks up from the cwd to a
project row and falls back to a default. A database does not: it has *instances*, each with its own
package version, its own data directory and its own port. `mariadb@main` and `mariadb@legacy` are
two answers to "which `mariadb-dump`", and the cwd says nothing about which.

### Complaint 2 — a globally installed tool is not a command

Measured on the reference machine rather than reasoned about:

```
$ node -e "console.log(process.execPath)"
…/.mixengine-home/runtimes/node/24.19.0/node.exe
$ npm config get prefix
…/.mixengine-home/runtimes/node/24.19.0
```

npm's global prefix is the runtime's own directory, so `npm install -g yarn` writes `yarn`,
`yarn.cmd` and `yarn.ps1` **into `runtimes/node/24.19.0/`** — a directory that is never on anybody's
PATH. Only `<root>/bin` is on the PATH, and `refresh` would delete a `yarn` put there by hand at the
daemon's next start, because `bin/` removes what no command names.

The same is true of `pip install --user`-style global installs (`<runtime>/Scripts` on Windows,
`<runtime>/bin` on Unix) and of `gem install` (`<runtime>/bin`).

And this is not a case of "put the runtime's directory on the PATH". A global tool belongs to **one
version of one language** — `yarn` installed under Node 24 is not installed under Node 22 — so the
name has to resolve the same way `npm` does, or `cd`-ing into a project that pins another Node would
silently run the wrong one.

### Complaint 3 — nothing tells a runtime about MixEngine's authority

`unable to verify the first certificate` is OpenSSL's `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: the chain
the server presented cannot be linked to a root the client trusts. The browser is fine because
`certs/ca/root.crt` is installed in the **OS trust store** (and in NSS on Linux) —
[.claude/features/tls.md](../../../.claude/features/tls.md) first run, step 3.

No language runtime reads that store:

- **Node** ships a compiled-in copy of the Mozilla set and consults nothing else unless it is told
  to (`NODE_EXTRA_CA_CERTS`, or `--use-system-ca` from Node 22).
- **Ruby**'s OpenSSL is compiled here with its default-path functions resolving against the loaded
  `libcrypto` — `<runtime>/ssl/cert.pem`, a file inside the moved tree
  ([.claude/operations/runtime-packaging.md](../../../.claude/operations/runtime-packaging.md)).
- **Python** uses OpenSSL's default paths for `ssl`, and `certifi`'s vendored bundle for anything
  built on `requests`.
- **PHP** uses `openssl.cafile` and `curl.cainfo`, and the artifact on the reference machine ships
  **no CA file at all**: `find runtimes/php -iname '*cacert*' -o -iname '*cert.pem*'` returns
  nothing. So PHP on Windows today cannot verify *any* HTTPS through the openssl streams — the local
  site is the case that made somebody notice, not the only case.

So a Node process reaching `https://ezweb.test` is doing exactly what it should and MixEngine has
never told it anything. The whole of this half of the spec is one sentence: **a runtime MixEngine
installed should trust the authority MixEngine issued the certificate from.**

---

## Decisions

| # | Decision |
| --- | --- |
| **D1** | `bin/` becomes a projection of **installed state**, not of a constant. Three sources compose it: `shims::COMMANDS` (unchanged), the client commands of installed service packages, and the tools discovered in installed runtimes' global directories. |
| **D2** | A **service client resolves to an instance**, not to a version: the instance decides the package version *and* the endpoint. With no instance, the highest installed version of that package runs, and no endpoint is exported. |
| **D3** | Compatibility aliases exist and **a real name always beats an alias**: MariaDB fronts `mysql`, `mysqladmin` and `mysqldump` — the three of its own programs that have a `mysql` spelling — and drops every one of them the moment a `mysql` package is installed. |
| **D4** | A client shim exports the instance's endpoint **through the client family's own variable and only when it is unset**: `MYSQL_HOST`/`MYSQL_TCP_PORT`, `PGHOST`/`PGPORT`. A family with no such variable (Redis, Memcached) exports nothing. |
| **D5** | Discovered global commands are recorded in a table, `bin_commands(name, kind)`. The daemon writes it; the shim reads one row. Service clients are **not** recorded — they derive from the compiled catalogue and the `packages` rows. |
| **D6** | The discovery pass is a **2-second mtime poll** of each installed runtime's global directory, with the interval settable. No new dependency, no per-OS watcher semantics. |
| **D7** | MixEngine generates **one merged trust bundle**, `etc/ca/bundle.pem` = every root the OS store holds **+** `certs/ca/root.crt`, through a new `mixengine-platform` capability over `rustls-native-certs`. |
| **D8** | Node is given `NODE_EXTRA_CA_CERTS = certs/ca/root.crt` — the one mechanism that is *additive*. Python, Ruby and PHP are given the **bundle**, because their mechanisms *replace*. |
| **D9** | **If the OS roots cannot be read, no bundle is written and nothing that replaces a trust store is exported.** Only Node's additive variable is. A `SSL_CERT_FILE` naming a file with one certificate in it would break every public handshake on the machine. |
| **D10** | The shim exports a variable **only when the file it names exists** — `surroundings`' existing rule for `PHP_INI_SCAN_DIR`, applied to the bundle. A home whose daemon has never run exports nothing. |
| **D11** | A variable the **user** has already set is never overwritten, in either direction. `mix doctor` reports the ones that shadow MixEngine's. |

---

## Part A — the client commands of a service (T130)

### A.1 A recipe declares its clients

`Recipe` gains two defaulted methods, beside `smoke_test` and `settings`:

```rust
/// One command `bin/` fronts on this package's behalf.
pub struct Client {
    /// What the user types, and the file name in `bin/`.
    pub name: &'static str,

    /// Which of the artifact's executables it runs, by the `provides` key.
    pub executable: &'static str,

    /// Whether this name is the package's own or a compatibility spelling of it.
    pub claim: Claim,
}

pub enum Claim {
    /// The name the package itself publishes. `mariadb`, `psql`, `redis-cli`.
    Own,
    /// A name from a product this one stands in for. MariaDB's `mysql`, and nothing else today.
    Alias,
}

trait Recipe {
    /// The commands a person runs out of this package, and `&[]` for a package with none.
    fn clients(&self) -> &'static [Client] { &[] }

    /// What a client is told about the instance it belongs to.
    fn client_env(&self, listen: &Upstream) -> BTreeMap<&'static str, String> { BTreeMap::new() }
}
```

**Declared rather than derived from `provides`**, and the reason is nginx: its map holds
`mime.types`, `fastcgi_params` and `scgi_params` beside `nginx.exe`. A `bin/` filled from `provides`
wholesale would hold a `mime.types` that is a copy of the shim binary. The same rule keeps the
supervised daemons out — `mariadbd`, `mysqld`, `postgres`, `redis-server`, `caddy`, `nginx` and
`memcached` are not client commands, and a shim in front of one would be a second way to start a
process nothing is supervising (`shims::COMMANDS`' own argument about `php-fpm`).

The set each recipe declares:

| Recipe | `Own` | `Alias` |
| --- | --- | --- |
| mariadb | `mariadb`, `mariadb-admin`, `mariadb-dump`, `mariadb-backup`, `mariadb-upgrade` | `mysql`, `mysqladmin`, `mysqldump` |
| mysql | `mysql`, `mysqladmin`, `mysqlbinlog`, `mysqlcheck`, `mysqldump`, `mysqlimport`, `mysqlshow`, `mysqlslap`, `mysql_upgrade` | — |
| postgres | `psql`, `pg_dump`, `pg_dumpall`, `pg_restore`, `pg_isready`, `createdb`, `dropdb`, `createuser`, `reindexdb`, `vacuumdb`, `pg_basebackup` | — |
| redis | `redis-cli` | — |
| memcached, caddy, nginx, php-fpm | — | — |

`initdb`, `pg_ctl`, `mariadb-install-db` and `pg_upgrade` are deliberately absent: they operate on a
data directory the daemon owns, and a person running one by hand against a live cluster is a
corrupted cluster. They stay reachable at their full path.

A name is only fronted if the installed package's `provides` actually holds its `executable` — the
`mariadb-backup` row is silently skipped on a build that did not pack it, the same way a runtime
shim answers the lookup with what the artifact *does* publish.

### A.2 Which instance a client belongs to

A new `core::services::client` module answers one question — *for this package name, which service
row is the client's* — in this order:

1. `MIXENGINE_<PACKAGE>` naming a service id (`MIXENGINE_MARIADB=mariadb@legacy`). An id that names
   no row is refused with the ids that exist, never skipped past.
2. Exactly one instance of that package → that one.
3. More than one → the instance holding the recipe's `preferred_port`, then the lowest port, then
   the lexicographically first id. Deterministic, and the first rule is the one that matches what a
   person means by "the MariaDB": the one on 3306.
4. No instance at all → no instance. The **highest installed version** of the package supplies the
   binary, and no endpoint variable is exported. `mysqldump -h db.example.com` against somebody
   else's server is a real use of a client and must not need a local instance.

Read straight out of SQLite by the shim, with no daemon: the `services` and `packages` rows are
there whether or not anything is running, which is the same promise
`crates/mixengine-shim/src/main.rs` already documents for runtimes.

### A.3 The endpoint a client is handed — D4

```
mariadb / mysql   MYSQL_HOST=127.0.0.1   MYSQL_TCP_PORT=<instance port>
postgres          PGHOST=127.0.0.1       PGPORT=<instance port>
redis, memcached  (nothing — no client-side environment exists)
```

**Only when unset.** A person who exported `MYSQL_TCP_PORT` for a tunnel meant it, and a tool that
overrode it would be a tool that cannot be used against anything but itself. The rule is checked in
the shim, where the user's own environment is visible.

This is the fix for a case that would otherwise be a silent wrong answer: `services.md` gives
3306 to whichever of MariaDB and MySQL asks first and the next free port above to the other, so on a
home with both, a bare `mysql` would open a session on the *other* product's server and report
success.

### A.4 Conflicts — D3

Two installed packages can claim one name. The resolution is a total order and it is computed by
the daemon at refresh, not by the shim:

1. An `Own` claim beats an `Alias` claim. (MariaDB's `mysql` disappears when the `mysql` package is
   installed.)
2. Two `Own` claims — possible with a MariaDB 10.x artifact, which still ships `mysql.exe` — are
   settled by *the instance*: a package with an instance beats one without; both with instances, the
   one whose instance holds the recipe's `preferred_port`; still tied, the package name ascending.
3. The winner and the losers are both reported in `Refreshed::conflicts`, so `mix doctor` can print
   `mysql runs mysql 5.7.44's client; mariadb 10.11's is at bin/mariadb` rather than leaving a
   person to find out by reading `--version`.

Never "front neither": a name a person expects and cannot type is the complaint this spec opens
with.

---

## Part B — a globally installed tool (T131)

### B.1 Where a runtime's global directory is

A fact about each language's package manager, held beside the runtime kind:

| Kind | Windows | Unix |
| --- | --- | --- |
| Node | `<install>/` | `<install>/bin` |
| Python | `<install>/Scripts` | `<install>/bin` |
| Ruby | `<install>/bin` | `<install>/bin` |
| PHP | — (Composer's global bin is `~/.composer/vendor/bin`, outside every install; out of scope) | — |

### B.2 Discovery

A daemon task stats each installed runtime's global directory every `[bin] rescan_seconds`
(default 2). A directory whose mtime is unchanged costs one `stat` and nothing else; creating or
removing a file in it changes the mtime on every filesystem this project supports, which is exactly
what `npm install -g` does.

A changed directory is re-read, and every entry that is **not** one of the following becomes a
discovered command for that kind:

- a name `shims::COMMANDS` already holds (`npm` must never be replaced by a copy of the shim),
- a name the artifact's own `provides` map holds (`node`, `node.exe`),
- a name a service client claims,
- one of `mix`, `mixengined`, `mixengine-shim`, `mixengine-elevate`,
- a file whose extension this OS does not execute (`.ps1`, `.json`, `.md`, a `LICENSE`).

On Windows the `.cmd`/`.exe`/`.bat` spellings of one name fold to one command, and the `.exe` is
preferred when both are present.

The result is written to `bin_commands(name TEXT PRIMARY KEY, kind TEXT NOT NULL)` — a projection,
rewritten whole in one transaction — and `bin/` is reconciled.

### B.3 What the shim does with one

`shims::dispatch` answers the static table first, unchanged and with no new work on the hot path.
A name it does not hold is looked up in `bin_commands`; a name there names a `RuntimeKind`, and from
there the shim does exactly what it does for `npm`:

1. resolve that kind for this directory (`MIXENGINE_NODE`, the project row, the default),
2. look for the name in **that version's** global directory,
3. hand over, with the same `PATH` and ini-set environment any command of that kind gets.

A version that does not have the tool is a sentence and not a "command not found":

```
yarn: node 22.14.0 is what this directory resolves to, and yarn is not installed for it
yarn: npm install -g yarn
```

Which is the honest answer, and the one the complaint is really asking for: `yarn` follows the Node
version the way `npm` does.

### B.4 Windows and `.cmd`

`yarn` on Windows is `yarn.cmd`, a batch file. `mixengine_platform::process::hand_over` builds a
`std::process::Command`, and Rust's standard library has run `.bat`/`.cmd` through `cmd.exe` with
batch-specific quoting since 1.77.2 — so no new platform code is needed. What it *cannot* quote
safely it refuses with `InvalidInput` rather than mis-quoting, which the shim turns into a named
sentence. An `.exe` is preferred where the package ships one, which avoids the question entirely for
tools that do.

### B.5 `bin/` is now on the PATH with names MixEngine did not choose

Stated because it is a real property and not a bug: a global npm package called `git` would put a
`git` on the PATH ahead of the machine's own. Every version manager that fronts global tools has
this property, the reserved list in B.2 keeps MixEngine's own names safe, and `mix doctor` names a
discovered command that shadows a program already on the PATH.

---

## Part C — the trust bundle (T132, T133)

### C.1 Reading the machine's roots — T132

`mixengine-platform` gains one method on its trust capability:

```rust
/// Every root this machine trusts, as DER. `None` where the store cannot be enumerated.
fn roots(&self) -> Result<Vec<Vec<u8>>>;
```

implemented over `rustls-native-certs`, which is **already in `Cargo.lock`** by way of
`rustls-platform-verifier`, and which reads the Windows `ROOT` store, macOS's trust settings and
Linux's `ca-certificates` file. It goes here and not in `core` for the standards' plain reason: no
`#[cfg]` above this crate.

Unprivileged on all three systems — `tls.md` already relies on reading the store costing no
privilege, which is why `cert.ca_status` asks the store every time rather than remembering a flag.

### C.2 Rendering the bundle — T132

`etc/ca/bundle.pem`, generated, disposable and rebuilt from state like everything else under `etc/`.
It is a `generate::document` so it gets the staging, diffing and atomic install the site files get —
a half-written bundle read by a runtime mid-handshake is every TLS connection on the machine failing
at once, and `document::install` is the machinery that already cannot produce one.

```
# Generated by MixEngine. Edits are overwritten, and nothing reads this file back into state.
# MixEngine authority: <sha256 fingerprint of certs/ca/root.crt>
# Machine roots: 147, read from the Windows ROOT store at 2026-09-15T09:14:02Z
-----BEGIN CERTIFICATE-----
…
```

The fingerprint in the header is what makes a rotation visible: `cert.ca_rotate` (T54) replaces the
authority, the header changes, the document differs, and the install happens for the same reason a
renewed leaf reloads a front end.

Written through `mixengine_platform::write_private`. The certificates in it are public, but a bundle
**another account can write** is that account choosing what every one of this user's runtimes
trusts.

Regenerated at daemon start and on `cert.ca_rotate`.

**And at the start it is spawned rather than awaited, which this section had wrong.** The order
above — authority → trust stores → browsers → bundle → certificates → generators — put it between
the endpoint's `bind` and the moment the daemon enters `accept`, and *every* moment spent there is a
moment a second client on Windows meets `ERROR_PIPE_BUSY`: a bound named pipe that nothing is
accepting on holds exactly one pending connection. Reading a whole OS trust store and writing a
quarter of a megabyte is the most expensive thing that had ever been put there, and it was measured
rather than reasoned about — ten of `crates/mixengine-daemon/tests/api.rs`' twenty-four daemons
stopped answering, against nought at the branch point.

So the task is spawned, and it owns the ordering it needed: when the bundle **moved**, it calls
`runtimes::extensions::refresh_all` itself, which is what writes the `openssl.cafile` lines into a
PHP's `conf.d` on the first start of a home. An ordinary start reaches neither — the bundle has not
changed, so nothing is written and nothing is regenerated.

**D9 in code**: `roots()` answering an error, or fewer than 20 roots, writes **no** bundle and
removes a stale one. Twenty is a floor rather than an estimate, and **the number this section first
gave for a real store was wrong**: "every system store on earth holds more than a hundred" is a
Linux figure. A daemon run against a stock Windows 11 for this task answered **35** — that store is
seeded with a small set and fetches the rest on demand. Twenty is still below every real answer and
far above a failed enumeration, which is the only distinction the constant has to make; raising it
towards a distribution's figure would refuse a working Windows.

### C.3 Exporting it — T133

In the shim's `surroundings`, under D10 (the file must exist) and D11 (the user's value wins):

| Kind | Variables |
| --- | --- |
| Node | `NODE_EXTRA_CA_CERTS` → `certs/ca/root.crt` |
| Python | `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` → `etc/ca/bundle.pem` |
| Ruby | `SSL_CERT_FILE` → `etc/ca/bundle.pem` |
| PHP | — (an ini, below) |

Node is given the **root** and not the bundle, deliberately. `NODE_EXTRA_CA_CERTS` is the only one of
these that *adds* to what the runtime already trusts, so handing it one certificate leaves Node's own
curated set exactly as Node shipped it and adds this home's authority to it. Handing it the bundle
would work and would be a larger change than the problem.

PHP goes through the generated ini set instead, in `00-mixengine.ini`
(`runtimes::extensions::render`):

```ini
; Every authority this machine trusts, and MixEngine's own.
openssl.cafile = "…/etc/ca/bundle.pem"
curl.cainfo = "…/etc/ca/bundle.pem"
```

That is the right place for three reasons: `PHP_INI_SCAN_DIR` is already exported by the shim and
already set on the pool's spec, so **`php -r` in a terminal and `curl_exec()` in a browser get the
same answer**, which is the property T28 exists to hold; Composer runs through PHP and inherits it;
and PHP on Windows has no CA file at all today, so this is the line that makes *any* verified HTTPS
work there, not only a `.test` one.

### C.4 What this changes about trust, stated plainly

Python and Ruby stop using their own curated root sets and start using the machine's. On a corporate
laptop with an inspection proxy's root in the OS store, a Python script will now trust that proxy —
the same answer the browser on the same machine gives. That is the intended behaviour and it is why
this wants an ADR rather than a line in a module doc.

---

## Cross-cutting

### `shims::refresh` and reconciliation

```rust
pub fn refresh(bin: &Path, shim: &Path, extra: &[Extra]) -> Result<Refreshed>;
```

`Extra` is one name the caller has decided belongs in `bin/`, and the caller is the daemon, which is
the only thing that can read the database. `COMMANDS` stays a constant and stays first. `Refreshed`
gains `conflicts: Vec<Conflict>`.

The three writers — start-up, `path.install` and the 2-second pass — are serialised behind one mutex
on `daemon::shims::Shims`. Without it, two passes could sweep against two different expectations and
delete each other's files; the window is small and the failure is a name on the PATH with nothing
behind it.

`shims::clear` is unchanged: an uninstall still empties the directory.

### A stale name

`bin/` can hold a name whose reason has gone — a runtime uninstalled between the copy and the run.
`unknown_command()`'s message ("this is a MixEngine shim and is not meant to be run under this
name", followed by nineteen names) is wrong for that case and gets its own:

```
yarn: nothing installed here answers to yarn any more
yarn: `mix path status` lists what bin/ holds
```

### API and CLI

| Method | CLI | What it is for |
| --- | --- | --- |
| `path.status` (existing) | `mix path status` | Gains the origin of each command — built in, a client of `<package>`, or a tool of `<kind>` |
| `path.rescan` (new) | `mix path rescan` | Runs the discovery pass and the reconciliation now, rather than within two seconds |

No client-only capability: both are reachable from `mix`, and the desktop's Settings screen draws
the listing from `path.status` as it already does.

`daemon.doctor` gains four checks: a bundle that is missing or has too few roots; a
`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` or `REQUESTS_CA_BUNDLE` already set in the daemon's own
environment; a client-name conflict; a discovered command that shadows a program found elsewhere on
the PATH. The first repairs without a prompt (regenerate); the rest report.

### Migration

`0022_bin_commands.sql` — one table, no data to carry. `cargo sqlx prepare` afterwards.

### Bindings

`Refreshed`, `PathReport` and the doctor findings are `mixengine-proto` types, so
`bash packaging/bindings.sh` runs and `bindings/` is committed with the change (T56).

### The desktop application

Unaffected and deliberately so. Its `rest` module makes its requests from Rust through
`rustls-platform-verifier`, which reads the OS store, which already holds this home's authority. It
is named here only so the next person does not go looking for a bug that is not there.

---

## Risks and what answers each

| Risk | Answer |
| --- | --- |
| The shim's 15 ms budget (T29) | The static table is answered first and unchanged. A service client costs one extra query; a discovered tool costs one. A benchmark asserts `php -v` has not moved. |
| `SSL_CERT_FILE` replacing a good store with a bad file | D9's floor, an atomic install, D10's existence check, and a doctor repair. |
| A stale bundle after an OS root update | Regenerated at every daemon start. A machine that has not restarted its daemon since a root was revoked keeps trusting it — the same exposure every pinned bundle in every language has, and shorter than most. |
| The 2-second poll against M7's idle promise | One `stat` per installed runtime per tick, and the interval is a setting. `bench`'s idle measurement is re-run and recorded in the phase file. |
| **What a daemon start now costs before it accepts** — the one risk this spec did not have, found by running the suite | Two things were put between the `bind` and the `accept` loop, where a bound named pipe on Windows holds one pending connection and every one after it meets `ERROR_PIPE_BUSY`. The bundle's store read is now **spawned**, and the first tick of the rescan is **one period away** rather than immediate. Measured both ways: ten of `tests/api.rs`' twenty-four daemons failed, and the branch point failed none. |
| Windows batch quoting | `.exe` preferred; Rust's std refuses rather than mis-quotes; the refusal is named. |
| `bin/` shadowing a machine's own `git` | Reserved list for MixEngine's names; doctor reports the rest; the property is documented. |
| Two refresh passes racing | One mutex. |
| MariaDB 10.x publishing `mysql` as an `Own` claim | A total order that ends in a package name, and the losing claim is reported rather than hidden. |

---

## Testing

- **`core::shims`** — reconciliation with extras: a name added, a name removed, a conflict resolved
  each of the three ways, a discovered name colliding with a reserved one.
- **`core::services::client`** — instance selection through all four rules, and the refusal for an
  id that names no row.
- **`core::generate::ca`** — a bundle rendered from a fixture set of roots; the fingerprint header
  changing when the authority changes; nothing written when `roots()` is short or fails; a stale
  bundle removed.
- **`mixengine-shim` integration** — the existing harness builds a home from a real `provides` map
  and fills `bin/` through `shims::refresh`. Extended with a fake service package and a fake global
  tool, asserting: the client runs, the endpoint variable is set, a user's own value is not
  overwritten, the CA variables name existing files, and `yarn` under a version that lacks it
  produces the sentence rather than a 127 with no reason.
- **No test may assume a port is free.** Instance selection is tested against rows, not listeners.
- Everything runs on all three OSes; the Windows-only halves (`.cmd`, `Scripts/`, the `ROOT` store)
  are `#[cfg]`-gated tests, not `#[cfg]`-gated behaviour.

## Out of scope

- Composer's own global bin (`~/.composer/vendor/bin`) — outside every install directory, and a
  different resolution question.
- `nvm`/`pyenv`-style shell integration. `bin/` on the PATH stays the only mechanism.
- Teaching a runtime to read the OS store directly (`--use-system-ca`) rather than a file. A
  file works on every version this project ships; the flag does not.
- Exporting the bundle to processes MixEngine does not start. A terminal that ran no shim gets
  nothing, which is what `mix path install` is for.

## Roadmap

New **phase 15 — what a terminal inherits**:

- **T130** the client commands of a service *(P)*
- **T131** a globally installed tool is a command *(P)*
- **T132** the machine's roots, and a bundle with ours in it *(P)*
- **T133** every runtime is told where that bundle is *(P)*
- **T134** `mix path rescan`, the doctor checks, and the documentation

**M15**: on a fresh install, `mysqldump` and `redis-cli` are commands; `npm install -g yarn`
followed by `yarn --version` works in the same shell; and a Node, PHP, Python or Ruby program
started through `bin/` fetches `https://<site>.test` without being told anything.

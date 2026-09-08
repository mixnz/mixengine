# T27c — Composer through the runtime pipeline (design)

Proposed roadmap task **T27c**, phase 2, following T27b: *"Composer is installed, pinned, listed and
run exactly as a runtime is — a fifth `RuntimeKind` whose one executable is a `.phar` the shim hands
to the project's PHP — and the gallery's `laravel` and `symfony` ask for it, so a machine that has
never seen Composer scaffolds a Laravel project after `--install-missing`."*

## What was observed, and how

T78b left every plan honest and every Laravel apply on a fresh machine still impossible: `mix
blueprint apply laravel --dry-run` says `blocked run composer create-project … — composer is not on
the PATH the command would run with`, and there is nothing in the product that puts it there.
`shims.rs` has said since T25 what would close that:

> **`composer`**, and every other tool that is not inside a language's archive. The feature spec
> lists it among the commands `bin/` will eventually hold, and it is a `.phar` fetched separately
> … It arrives with the task that installs it.

So this is not the reversal of a decision — T25 deferred Composer to the task that could install it,
and [runtime-versions.md](../../.claude/features/runtime-versions.md) still lists `composer` in the
shim table. It is that task.

Three facts shape it, each checked rather than assumed:

- **Composer is one file with no runtime of its own.** Every release of
  [`composer/composer`](https://github.com/composer/composer/releases) publishes `composer.phar`
  and a PGP `.asc`; [getcomposer.org](https://getcomposer.org/download/) publishes the same file
  and a `composer.phar.sha256sum` beside it. Running it is `php composer.phar …`, under whichever
  PHP the project uses. Composer 2.3 and later need PHP 7.2.5 or newer; the 2.2 line is the LTS for
  anything older.
- **The runtime pipeline already does everything but the last step.** Signed index, resumable
  download, staging and atomic rename, `runtime_installs` rows, per-project pins in
  `mixengine.toml`, a default per kind, `mix runtime install|list|uninstall|default`, blueprint
  `[runtimes]`, capture — all keyed on `RuntimeKind`. The one thing keyed on it that Composer cannot
  satisfy is the shim's hand-over, which runs *the artifact's executable*; a `.phar` is not one.
- **The only place the set of kinds is closed by hand is the database.** `runtime_installs.kind`
  carries `CHECK (kind IN ('php', 'node', 'python', 'ruby'))` from `0001_initial.sql`; pins are
  JSON keyed by the kind's word, the index's `kind` is a free string, and every other consumer reads
  `RuntimeKind::ALL`.

## Goal

`mix runtime install composer 2` puts a Composer on the machine that `composer` in a terminal runs
under the project's PHP. A blueprint pins it like any runtime. The gallery's `laravel` and `symfony`
ask for it, so their plans say `create composer 2` where they said `blocked`, and `--install-missing`
makes them apply end to end on a machine with nothing installed. Nothing changes for a machine that
never installs Composer.

## Scope

**In:**

- `RuntimeKind::Composer`, and every consequence `RuntimeKind::ALL` already carries.
- A migration widening the `runtime_installs` `CHECK`.
- The shim's second shape: a command run *through* another kind's program.
- An installer that can skip the smoke test for a kind whose artifact starts nothing.
- The gallery's `laravel` and `symfony` pinning `composer = "2"`.
- In `mixengine-packages`: a `composer` recipe, its workflow, its page, and two published lines.
- Handbook and feature-doc sentences that say Composer is a runtime here.

**Out:**

- Enforcing Composer-to-PHP compatibility. The pin says which Composer, the same way it says which
  PHP, and a wrong pair fails the way it fails on any machine — with Composer's own message.
- An `os: any` cell in the index schema. Six identical artifacts cost six small uploads and no
  schema bump; the day a second OS-independent artifact appears is the day the schema earns one.
- A `composer` that is *not* a version choice — a "just the newest" tool with no pin. The pipeline
  gives pins for free, and PHP 7.x projects need the 2.2 line, so the choice is real.
- Verifying Composer's PGP signature in the recipe. The keyserver is a moving dependency on a
  machine with nothing installed; what is checked is a second publisher's SHA-256 over HTTPS — the
  trade the Node.js and Caddy recipes already record.
- Anything about `npx`, `pip`, `gem` or a general "tool" concept. One kind, for the one tool two
  gallery blueprints need.

## Decisions

**D1 — Composer is the fifth `RuntimeKind`.** `RuntimeKind::Composer`, spelled `composer`
everywhere the others are spelled (`kind` column, index `kind`, wire, command line), with
`override_env` `MIXENGINE_COMPOSER` derived the way the other four are. `ALL` becomes five and keeps
its order: `php, node, python, ruby, composer` — last, because it is the one that runs under another.
Everything that reads `ALL` — `mix runtime list`, `runtime.available`, capture, the CLI's "it knows
…" message, the `CHECK`-agrees-with-the-enum test — follows without a change of its own.
`bindings/` is regenerated.

**D2 — Migration `0019_composer_runtime.sql` widens the `CHECK`.** SQLite cannot alter a
constraint, so the table is rebuilt the way `0016_extensions.sql` rebuilt `services`: `-- no-transaction`,
`PRAGMA foreign_keys = OFF`, copy out to `runtime_installs_new` with the wider `CHECK`, copy back,
drop, rename, recreate the partial unique index `runtime_installs_one_default_per_kind`,
`PRAGMA foreign_key_check`, commit. `services.runtime_install_id` references this table with
`ON DELETE RESTRICT`, which is why the pragma is off and the check is run. Nothing else names a
runtime kind in a constraint.

**D3 — The artifact is `composer.phar` in an archive, six cells, no smoke test.**
`runtimes/composer/<version>/composer.phar`, published as `composer-<version>-<os>-<arch>.zip` on
Windows and `.tar.zst` elsewhere, exactly as every other runtime — the installer sees nothing new.
`provides` is `{"composer": "composer.phar"}`. The index schema has no OS-independent cell, so the
recipe writes six identical artifacts and the index carries six entries with one SHA-256 (see Scope).
`runtimes::smoke_test(kind)` becomes `Option<SmokeTest>` and answers `None` for Composer: the
installer's check runs *the artifact's executable*, and a `.phar` has none — what the download proved
by hash is the whole of what can be proved without a PHP, and asking for one at install time would
make `mix runtime install composer` fail on the machine the gallery blueprint is about to install
PHP on.

**D4 — The shim's second shape: run through another kind.** `shims::Command` gains
`via: Option<RuntimeKind>`. The `composer` row is `{ name: "composer", kind: Composer, executable:
"composer", via: Some(Php) }`; the eighteen existing rows carry `None`. For a row with `via`, the
shim resolves **two** runtimes for the same directory: the command's own kind, which names the file
(`composer.phar`), and the `via` kind, which names the program (`php`) — each through
`resolve::runtime` with its own override variable, so `MIXENGINE_PHP=8.1 composer install` means
what it says. The hand-over is `hand_over(php, [composer.phar, args…], surroundings(php))`: the
environment is the *program's*, so `PATH` gains PHP's own directory and `PHP_INI_SCAN_DIR` names
PHP's generated ini set — the same `php -m` a terminal sees. A `via` kind that resolves nothing is a
refusal in the shim's own voice, naming the install command for the kind that is missing
(`composer: no PHP is installed — mix runtime install php 8.4 …`), because the person typed
`composer` and the thing they lack is a PHP. `core::shims::dispatch` and `refresh` are unchanged:
a row is a row.

**D5 — Compatibility is the pin's, not the product's.** Composer's own floor is Composer's to
state, and it does: `composer.phar` under a PHP that is too old prints one line saying so. The
handbook says which line goes with which PHP (2.2 for PHP older than 7.2.5, 2 otherwise) and the
gallery pins `2`, since every gallery PHP is 8.x. Encoding the table here would be a second copy of
a fact Composer owns.

**D6 — The gallery asks for it.** `laravel.toml` and `symfony.toml` gain `composer = "2"` under
`[runtimes]`. On a machine without Composer the plan reads `create composer 2`, `--install-missing`
installs it beside PHP, and the T78b check — which looks for `composer` on the PATH the command runs
with — is satisfied by the shim that `bin/` now always holds, whether or not a Composer is
installed. That is the right division: the shim's existence is the plan's question, and *which*
Composer runs is the resolver's, exactly as for `php`. `nextjs` is unchanged. `blueprint_gallery`'s
"on a machine with nothing installed" test gains nothing to fake: `composer` is in `bin/` because the
table says so.

**D7 — No service, no `conf.d`, no post-install hook.** The recipe walk that makes a `php-fpm`
pool per PHP install names `RuntimeKind::Php` and only that; `runtimes::extensions::conf_d` renders
nothing for an artifact that declares no extension directory; the shim keys `PHP_INI_SCAN_DIR` off
the directory existing. Adding the variant makes every exhaustive `match` on `RuntimeKind` a compile
error, which is the list of places to read — `smoke_test` (D3), `as_str`, `override_env` — and
nothing else is expected to need a Composer arm.

**D8 — The recipe borrows, checks against a second publisher, and proves it runs.**
`tools/composer.py` in `mixengine-packages`, one recipe for every target like `caddy.py`:

- Resolves `2`, `2.2`, `2.10.3` or `latest` against the GitHub releases of `composer/composer`
  (tags `2.x.y`, no drafts or pre-releases), with the same `GH_TOKEN` handling.
- Downloads the release's `composer.phar`, fetches
  `https://getcomposer.org/download/<version>/composer.phar.sha256sum`, and refuses on a mismatch.
  Two publishers, one hash, no keyserver.
- Smoke: `php composer.phar --version` with the runner's own PHP (every GitHub image ships one),
  from a directory the file was moved to, expecting the version in the output. This proves the
  phar is a phar and not a rate-limit page.
- `describe` writes `kind: composer`, `source: borrowed`, `upstream.project: composer/composer`,
  `upstream.verified_against: "getcomposer.org composer.phar.sha256sum over HTTPS"`, `provides:
  {"composer": "composer.phar"}`. No `requires`: nothing is linked.
- `borrow.publish` packs `composer.phar` + `mixengine-artifact.json` under the target's suffix.

`build-composer.yml` is `build-caddy.yml` with the name changed and the release notes rewritten;
one job, six legs, one release per version (`composer-2.10.3`). `docs/packages/composer.md`,
a README table row, a `roadmap.md` entry and an `adding-a-version.md` line say what was packed.
`eol.dated` answers `None` for a kind it has no table for, which is right: Composer states no
end-of-life dates.

**D9 — Publish order: packaging first.** `crates/mixengine-core/tests/index.rs` (T92, `#[ignore]`,
the one test that reads the real index) asserts every `RuntimeKind` has all six cells. So the
`composer-2.10.3` and `composer-2.2.x` releases and the re-published index land before the PR here
merges; until then the T92 check is red by construction, and the PR says so.

**D10 — Words.** `runtime-versions.md` gains the sentence that Composer is a kind and how it is
run; the roadmap gets T27c under phase 2 and the phase table's count moves to 14 / 14; the
handbook's runtimes page gets a Composer paragraph with D5's line table; `client-surface.md` needs
nothing, since no method is added.

## Testing

- **`mixengine-proto`**: the existing one-spelling and closed-set tests over `ALL` cover the fifth
  kind; `override_env` is asserted as `MIXENGINE_COMPOSER`.
- **`mixengine-core`**: `the_kind_column_accepts_every_kind_and_nothing_else` walks `ALL` and so
  proves the migration; a migration test that a home with four kinds installed migrates and keeps
  its rows and its default; `smoke_test(Composer)` is `None` and the other four are `Some`;
  `blueprint_gallery`: `laravel` and `symfony` plan a `composer` runtime step and, on a machine with
  no runtimes, nothing is blocked; `shims::COMMANDS` has a `composer` row with `via: Some(Php)` and
  every other row `None`.
- **`mixengine-cli`**, a new `composer.rs` suite against `MockRegistry`: an index offering a fake
  `php` (a program that prints its arguments — `fakeservice` gains a `--echo-args` mode that prints
  every positional and exits 0) and a fake `composer` whose archive holds a `composer.phar` of any
  bytes. `mix runtime install php` and `mix runtime install composer`, then `bin/composer --version`
  from a project directory prints the phar's path followed by `--version` — proof the hand-over went
  through the resolved PHP with the phar first. And `bin/composer` with no PHP installed refuses,
  naming `mix runtime install php`.
- **`mixengine-cli`**, in the `blueprint` suite: `mix blueprint apply laravel --dry-run` on a home
  with nothing installed lists `create composer 2` and no `blocked` step.
- **`mixengine-packages`**: the recipe run on all six legs by its workflow, `verify.py` over the
  regenerated index, and `check-archive` seeing the new releases.
- **By hand, on this machine**: install the published Composer into a sandbox home beside a PHP,
  run `composer --version` from a project pinned to that PHP, and `mix blueprint apply laravel
  --install-missing --run-scaffold` into a scratch directory — the twelfth step runs.

## What this closes, and where it is written

- `.claude/roadmap/phase-2-runtimes.md`: a `T27c` entry after T27b, ticked when it lands, pointing
  at this document; `.claude/roadmap/todo.md`'s phase-2 row.
- `.claude/features/runtime-versions.md`: Composer in the kinds, the `via` sentence under *Shims*,
  and the T25 note in `crates/mixengine-core/src/shims.rs` rewritten from "arrives with the task
  that installs it" to what the row is.
- `docs/guide/en/runtimes.md`: the Composer paragraph, with D5's line table. The handbook is one
  corpus published three ways (ADR 0021), so `packaging/docs.sh` restamps the translations after
  the English page changes.
- `mixengine-packages`: `README.md` table, `docs/packages/composer.md`, `docs/roadmap.md`,
  `docs/adding-a-version.md`.
- The gap T78b made visible — `laravel` and `symfony` reading `blocked` on a fresh machine — closes.

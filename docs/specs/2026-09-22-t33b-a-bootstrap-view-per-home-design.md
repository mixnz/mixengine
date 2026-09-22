---
status: approved
date: 2026-09-22
task: T33b
---

# T33b: A bootstrap view per home

Follow-up to [T33](2026-08-20-t33-mariadb-design.md), phase 3. 2026-09-22.

## The case

On macOS and Linux, a MySQL-family first run does not call upstream's install script with the real
paths. Upstream leaves `$basedir` and `$datadir` unquoted, so a home with a space in its path breaks
it. `generate::recipes::space_free_view` gives the script a view in `/tmp` instead: a directory
holding two links, `basedir` to the install and `datadir` to the data directory. The ritual's
first step runs `rm -rf` on the view and makes it again. Its last step removes it.

The view is named after the service id alone: `/tmp/mixengine-init-<service id>`. Two homes on
one machine that bootstrap a service with the same id share one view:

- **Two homes of one user.** The second ritual's first step removes the view the first is still
  using. T33b's roadmap entry records this, measured in WSL: a second ritual starting 0.2 s or
  0.5 s after the first kills it with `[ERROR] Aborting`, and at 1.5 s the first finishes one file
  short.
- **Two users of one machine.** `/tmp` is shared and sticky. The second user's `rm -rf` on the first
  user's view fails, and that user's first run fails with it until the machine reboots.

It affects MariaDB on every Unix, and MySQL on the script route (5.6). PostgreSQL does not use the
view.

The roadmap entry also names the keyring entry for the root password as "keyed the same way".
**That half is already fixed.** T126 made the address `<home id>/<service id>/<user>`
(`services::handoff::secret_key`, [ADR 0032](../decisions/0032-a-keyring-address-names-the-home-it-belongs-to.md)).
Only the view is left.

## D1. The view names the home

```text
/tmp/mixengine-init-<home id>-<service id>
```

For example, `/tmp/mixengine-init-9f3c1a77b204-mariadb@main`. `Context` already carries the home id
for the keyring address, so `space_free_view` reads it from there too. Nothing else changes: the
same `/tmp`, the same two steps, the same `rm -rf` at the start and at the end.

**Why the home id, and not a hash of the home's path.** ADR 0032 settled this for the keyring. A
home id is random, six bytes wide, and stays with a home that moves. It is also already the thing
that tells two homes apart everywhere else in the product.

**Why not a fresh `mktemp -d` per ritual.** The view is a path in the arguments of three steps, and
those arguments are built before any step runs. A random name made inside the first step's shell
could not reach the next two steps.

## D2. The tests say what is true

Three suites avoid the collision today by giving their second test an instance of its own:
`RESET` in `tests/mariadb.rs`, `tests/mysql.rs` and `tests/postgres.rs`, and `HANDOFF` in
`tests/mariadb.rs`. Each carries a paragraph explaining that the view is keyed on the service id
alone. After D1, that paragraph is wrong. In `postgres.rs` it was never right, because PostgreSQL
never used the view.

The names stay. They cost nothing, and a test that drives its own instance is easier to read in a
log. The paragraphs are rewritten to say that the names are for reading, and that the collision
they used to avoid is T33b's and has been fixed.

## How it is proven

- **`recipes.rs` unit tests:**
  - two contexts that differ only in their home id get two different views;
  - the view contains both the home id and the service id, and no space.
- **The existing recipe tests** for MariaDB and MySQL, which assert the steps, keep passing with
  the new path. Where one of them spells the view, it now spells `TEST_HOME` into it.
- **`tests/mariadb.rs` and `tests/mysql.rs`**, the real-server suites in CI's `services` legs, stay
  green. They run on Linux and bootstrap through the view.

## What this does not do

- It does not clean up views that older versions left in `/tmp` after a failed run. They are named
  in the old shape, nothing reads them, and `/tmp` is cleared on reboot.
- It does not move the view out of `/tmp`. `/tmp` is where it is because the home may contain a
  space, and that reason is unchanged.
- It does not guard against another user on the machine creating the view's path first. That user
  would need to know the home id, and the worst they could do is make the first run fail, which
  they can already do today by filling `/tmp`.

## Alternatives not taken

- **Put the view under the home's `run/` directory.** The home is exactly where the space is.
- **Only use the view when a path contains a space.** `space_free_view`'s own comment turned this
  down: one code path that every Unix first run exercises beats a branch only taken on the machines
  nobody tests on.
- **Change the three suites back to `SERVICE`**, so CI bootstraps one id in two homes at once and
  proves the fix against a real server. It would prove more, but it only fails when the two
  rituals overlap, which depends on timing. A unit test on the path proves the property itself,
  every time.

## Settled before approval

1. **The suites keep their separate instance names** (D2), with the comments rewritten.

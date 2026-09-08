-- no-transaction
-- Composer is the fifth runtime kind — roadmap task **T27c**, the design's D2.
--
-- `runtime_installs.kind` carries `CHECK (kind IN ('php', 'node', 'python', 'ruby'))` from 0001,
-- and SQLite cannot alter a CHECK in place, so the table is rebuilt the way 0016 rebuilt
-- `services`: copy out, copy back, drop, rename. `services.runtime_install_id` references this
-- table with `ON DELETE RESTRICT`, which is why foreign keys are off for the drop and
-- `foreign_key_check` proves afterwards that every pool still points at its runtime.
--
-- `-- no-transaction` on the first line for 0016's reason: `PRAGMA foreign_keys` is a no-op inside
-- the transaction sqlx would otherwise open. The BEGIN below takes back as much atomicity as SQLite
-- gives.
--
-- Every column is 0001's, plus `provides_json` (0002) and the three extension columns (0005) — the
-- only migrations that have touched this table. SQLite drops a table's indexes with the table, so
-- the partial unique index — one default per kind — is recreated by name below. No trigger has ever
-- been defined on this table.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE runtime_installs_new (
    id                     INTEGER PRIMARY KEY,
    kind                   TEXT    NOT NULL CHECK (kind IN ('php', 'node', 'python', 'ruby', 'composer')),
    version                TEXT    NOT NULL,
    channel                TEXT    NOT NULL,
    install_path           TEXT    NOT NULL,
    installed_at           TEXT    NOT NULL,
    size_bytes             INTEGER NOT NULL,
    source_url             TEXT    NOT NULL,
    sha256                 TEXT    NOT NULL,
    is_default             INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    provides_json          TEXT    NOT NULL DEFAULT '{}',
    extension_dir          TEXT    NOT NULL DEFAULT '',
    extensions_json        TEXT    NOT NULL DEFAULT '{}',
    extension_choices_json TEXT    NOT NULL DEFAULT '{}',

    UNIQUE (kind, version)
) STRICT;

INSERT INTO runtime_installs_new
    (id, kind, version, channel, install_path, installed_at, size_bytes, source_url, sha256,
     is_default, provides_json, extension_dir, extensions_json, extension_choices_json)
SELECT
     id, kind, version, channel, install_path, installed_at, size_bytes, source_url, sha256,
     is_default, provides_json, extension_dir, extensions_json, extension_choices_json
FROM runtime_installs;

DROP TABLE runtime_installs;

ALTER TABLE runtime_installs_new RENAME TO runtime_installs;

-- One default per kind, as 0001 wrote it: a plain UNIQUE (kind, is_default) would forbid a second
-- *non*-default PHP, which is the normal case and the reason this product exists.
CREATE UNIQUE INDEX runtime_installs_one_default_per_kind
    ON runtime_installs (kind) WHERE is_default = 1;

-- What the pragma was turned off for: proof that nothing was left pointing at a row that is no
-- longer there. A violation here fails the migration rather than leaving a home to find out later.
PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

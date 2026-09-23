-- no-transaction
-- Who left this service stopped — roadmap task **T123**.
--
-- 0010 wrote this down as `idle_stopped`, a boolean, and a boolean was one state short. It answered
-- *did the daemon idle this?*, and everything that was not an idle stop fell into the same bucket as
-- `mix service stop` — including the two cases that are not a decision at all: a row that has never
-- run, and one the daemon itself put down. On-demand activation reads this column to refuse a start
-- a person's stop forbids, so both of those were refused too, and a PHP site answered 502 until
-- somebody started its pool by hand. `resource-isolation.md` promises the opposite in as many words:
-- *no error page, no manual start*.
--
-- So the column says **who**, in three answers, and the reader compares against one of them:
--
--   `person`  a client asked for this stop and nothing may undo it — the design's D8, unchanged.
--   `daemon`  MixEngine stopped it: an idle sweep, a shutdown, or a process that vanished under it.
--   `never`   nobody has stopped it. A row that has not run yet, and where the service is running.
--
-- **NOT NULL with a third word rather than NULL for "never"**, which would have been the smaller
-- diff. `stopped_by != 'person'` is NULL — and therefore not true — for a NULL row, so the one query
-- shape every reader wants would have silently skipped exactly the rows this task exists to wake.
--
-- **What the old column cannot say, `last_started_at` can.** An `idle_stopped = 0` row is either a
-- person's stop or a service that never ran, and the difference is whether anything ever started it.
-- A row that ran and was stopped by something other than the idle sweep stays `person`: this
-- migration errs towards leaving a stop in place, because waking a service somebody deliberately
-- stopped is the one mistake here that cannot be undone by waiting.
--
-- SQLite cannot alter a CHECK in place and will not drop a column that appears in one, so the table
-- is rebuilt the way 0016 built it and 0019 rebuilt `runtime_installs`: copy out, copy back, drop,
-- rename. `sites.php_service_id` and `site_service_links.service_id` reference this table, which is
-- why foreign keys are off for the drop and `foreign_key_check` proves afterwards that every one of
-- them still points at a row that is there.
--
-- `-- no-transaction` on the first line for 0016's reason: `PRAGMA foreign_keys` is a no-op inside
-- the transaction sqlx would otherwise open. The BEGIN below takes back as much atomicity as SQLite
-- gives.
--
-- Every column is 0016's — the last migration to touch this table — with `idle_stopped` replaced in
-- its own place. No index or trigger has ever been defined on it.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE services_new (
    id                    TEXT    PRIMARY KEY,
    package_id            INTEGER REFERENCES packages (id) ON DELETE RESTRICT,
    runtime_install_id    INTEGER REFERENCES runtime_installs (id) ON DELETE RESTRICT,
    extension_id          TEXT    REFERENCES extensions (id) ON DELETE RESTRICT,
    instance_name         TEXT    NOT NULL,
    state                 TEXT    NOT NULL CHECK (state IN (
                              'stopped', 'starting', 'running', 'degraded',
                              'stopping', 'restarting', 'failed')),
    autostart             INTEGER NOT NULL DEFAULT 0 CHECK (autostart IN (0, 1)),
    port                  INTEGER,
    activation_port       INTEGER,
    bind_addr             TEXT    NOT NULL DEFAULT '127.0.0.1',
    data_dir              TEXT,
    config_overrides_json TEXT    NOT NULL DEFAULT '{}',
    limits_json           TEXT    NOT NULL DEFAULT '{}',
    idle_minutes          INTEGER,
    stopped_by            TEXT    NOT NULL DEFAULT 'never'
                              CHECK (stopped_by IN ('never', 'person', 'daemon')),
    last_started_at       INTEGER,
    last_exit_code        INTEGER,
    pid                   INTEGER,
    pid_start_time        INTEGER,

    -- Exactly one parent of three, as 0016 wrote it.
    CHECK (((package_id IS NOT NULL)
            + (runtime_install_id IS NOT NULL)
            + (extension_id IS NOT NULL)) = 1),

    UNIQUE (package_id, instance_name),
    UNIQUE (runtime_install_id, instance_name),
    UNIQUE (extension_id, instance_name)
) STRICT;

INSERT INTO services_new
    (id, package_id, runtime_install_id, extension_id, instance_name, state, autostart, port,
     activation_port, bind_addr, data_dir, config_overrides_json, limits_json, idle_minutes,
     stopped_by, last_started_at, last_exit_code, pid, pid_start_time)
SELECT
     id, package_id, runtime_install_id, extension_id, instance_name, state, autostart, port,
     activation_port, bind_addr, data_dir, config_overrides_json, limits_json, idle_minutes,
     CASE
         WHEN idle_stopped = 1          THEN 'daemon'
         WHEN state <> 'stopped'        THEN 'never'
         WHEN last_started_at IS NULL   THEN 'never'
         ELSE                                'person'
     END,
     last_started_at, last_exit_code, pid, pid_start_time
FROM services;

DROP TABLE services;

ALTER TABLE services_new RENAME TO services;

-- What the pragma was turned off for: proof that nothing was left pointing at a row that is no
-- longer there. A violation here fails the migration rather than leaving a home to find out later.
PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

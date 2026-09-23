-- The schema from docs/architecture/data-model.md, as v0.0.7 — the first release of MixLab — ships
-- it. The twenty-seven migrations that built it up during development were folded into this one
-- file before that release: no database written by an earlier build is carried forward, so every
-- home starts here, and every change from here on is a new migration after this one.
--
-- Four conventions hold throughout, and none of them is worth re-deciding per table:
--
--   * STRICT. Without it SQLite stores whatever it is handed, so a version written as the number
--     8.3 instead of the string "8.3" comes back as 8.3000000000000007 and a port written as "80"
--     compares less than 9. The whole point of keeping declared state in a database rather than in
--     JSON files is that it refuses what does not fit.
--   * Times are ISO-8601 UTC text ("2026-08-11T09:14:03Z"). Text because a database a user opens in
--     a viewer during a support conversation should be readable, and because lexical order is
--     chronological order for this format anyway. **The exception is a moment the daemon does
--     arithmetic on**, which is epoch milliseconds and says so at the column: `services.last_started_at`
--     and the two on `jobs`, among others. They are read back and compared rather than displayed,
--     and text would mean parsing a date on the path that compares it — with a civil-calendar
--     dependency this workspace has never otherwise needed.
--   * Booleans are INTEGER 0/1 with a CHECK, which is what SQLite has; the CHECK is what stops a 2.
--   * A `*_json` column is TEXT holding one JSON document, parsed by `serde_json` on the way out.
--     These are settings blobs nothing queries into — the moment something needs to filter on a
--     field, that field becomes a column in a new migration.
--
-- Closed vocabularies are CHECKed because they are fixed by the product: the runtime kinds, the site
-- kinds, the seven states of `mixengine_proto::ServiceState` and the four of
-- `mixengine_proto::JobState`. SQLite cannot alter a CHECK in place, so widening one later means
-- rebuilding the table under `-- no-transaction` with foreign keys off, and proving afterwards with
-- `PRAGMA foreign_key_check` that nothing was left pointing at a row that is no longer there.

-- Runtimes and packages -------------------------------------------------------------------------

CREATE TABLE runtime_installs (
    id                     INTEGER PRIMARY KEY,
    kind                   TEXT    NOT NULL
                           CHECK (kind IN ('php', 'node', 'python', 'ruby', 'go', 'java', 'composer')),
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

-- One default per kind: a plain UNIQUE (kind, is_default) would forbid a second *non*-default PHP,
-- which is the normal case and the reason this product exists.
CREATE UNIQUE INDEX runtime_installs_one_default_per_kind
    ON runtime_installs (kind) WHERE is_default = 1;

CREATE TABLE packages (
    id            INTEGER PRIMARY KEY,
    -- caddy | nginx | mariadb | postgresql | redis | memcached | mongodb | … Not CHECKed: the list
    -- grows with every package and every extension that ships a service, which is a registry entry
    -- rather than a schema change.
    name          TEXT    NOT NULL,
    version       TEXT    NOT NULL,
    install_path  TEXT    NOT NULL,
    installed_at  TEXT    NOT NULL,
    source_url    TEXT    NOT NULL,
    sha256        TEXT    NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    provides_json TEXT    NOT NULL DEFAULT '{}',

    UNIQUE (name, version)
) STRICT;

-- Tools somebody installed into a runtime — `npm install -g yarn` — which `<root>/bin` fronts. A
-- shim is handed only the name it was invoked by, and this is how it learns which language's version
-- resolution decides which copy runs. **A projection and never a record**: `bin_commands::record`
-- rewrites it whole in one transaction, the way `etc/` is rebuilt rather than patched.
CREATE TABLE bin_commands (
    -- The command as it is typed, with no executable suffix — `yarn`, not `yarn.cmd`. Folded to
    -- lower case by the writer on Windows, where `Yarn` and `yarn` are one file and two rows would
    -- be two copies of the shim racing for one name.
    name TEXT PRIMARY KEY,

    -- `mixengine_proto::RuntimeKind`, spelled exactly as `RuntimeKind::as_str` writes it. Not
    -- CHECKed for the reason `packages.name` is not: the list is Rust's and closed there, and a
    -- constraint here would be a second opinion about the same vocabulary — `bin_commands::all` is
    -- what refuses a word this build cannot read, with a sentence naming the row.
    kind TEXT NOT NULL
) STRICT;

-- Extensions ------------------------------------------------------------------------------------

CREATE TABLE extensions (
    -- The `ExtensionId`, which is also the directory name and — for a `service` — the first half of
    -- its `ServiceId`.
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    -- The extension's own version, not MixEngine's.
    version       TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('service', 'web-app', 'recipe')),
    -- **The manifest as the reader rendered it, not as its author wrote it.** A manifest kept as
    -- somebody's text makes the file on disk, this column and what the renderer reads three texts for
    -- one extension. This column is the source of truth for the spec, and nothing re-reads
    -- `extension.toml` out of `install_dir` — that file sits where a user can edit it, so a manifest
    -- read back from it is one nobody consented to.
    manifest_json TEXT NOT NULL,
    install_dir   TEXT NOT NULL,
    -- **Outside `install_dir`.** An uninstall removes the install directory whole and keeps this one
    -- unless asked otherwise, which a `data` nested inside it would make impossible to promise.
    data_dir      TEXT NOT NULL,
    -- Where it came from. `path` is `mix extension install --path`, which nothing vouches for.
    source        TEXT NOT NULL CHECK (source IN ('registry', 'path')),
    -- Whether a signature covered it. Two-valued because the registry's signature covers the whole
    -- document, so an entry either arrived inside something the compiled-in key vouched for or the
    -- document was refused entirely. There is no third answer to record, which is where this differs
    -- from `blueprints.signature`.
    signed        INTEGER NOT NULL CHECK (signed IN (0, 1)),
    installed_at  TEXT NOT NULL
) STRICT;

CREATE TABLE extension_ports (
    extension_id TEXT    NOT NULL REFERENCES extensions (id) ON DELETE CASCADE,
    -- The `[ports]` key, which is also the placeholder `{ui_port}` renders from.
    name         TEXT    NOT NULL,
    port         INTEGER NOT NULL UNIQUE,

    PRIMARY KEY (extension_id, name)
) STRICT;

-- Services --------------------------------------------------------------------------------------

CREATE TABLE services (
    -- The human-stable ServiceId — "mariadb@main", "php-fpm@8.3" — and not a rowid, because it is
    -- what the user types, what the log directory is named after and what an event carries.
    id                    TEXT    PRIMARY KEY,
    -- **Three possible parents, and exactly one of them set.** A server comes out of a `packages`
    -- row; php-fpm comes out of a `runtime_installs` one, because the process that serves a user's
    -- sites lives inside the PHP they installed; an extension's service out of `extensions`. Giving
    -- php-fpm a `packages` row as well would be a second table describing one directory. RESTRICT,
    -- not CASCADE: uninstalling a parent while an instance still refers to it is a mistake to
    -- report, not one to carry out, and the foreign key is what gives `runtime.uninstall` its
    -- refusal for nothing. The instance owns data_dir.
    package_id            INTEGER REFERENCES packages (id) ON DELETE RESTRICT,
    runtime_install_id    INTEGER REFERENCES runtime_installs (id) ON DELETE RESTRICT,
    extension_id          TEXT    REFERENCES extensions (id) ON DELETE RESTRICT,
    instance_name         TEXT    NOT NULL,
    -- `mixengine_proto::ServiceState`, spelled exactly as `ServiceState::as_str` writes it. The list
    -- is closed in Rust too, so this constraint is not a second opinion about the vocabulary — it is
    -- what stops a hand-edited database, or a future migration writing a literal, from putting a
    -- word in here that the daemon cannot read back and cannot act on.
    state                 TEXT    NOT NULL CHECK (state IN (
                              'stopped', 'starting', 'running', 'degraded',
                              'stopping', 'restarting', 'failed')),
    autostart             INTEGER NOT NULL DEFAULT 0 CHECK (autostart IN (0, 1)),
    -- Null for a service that listens on a socket rather than a port.
    port                  INTEGER,
    activation_port       INTEGER,
    bind_addr             TEXT    NOT NULL DEFAULT '127.0.0.1',
    data_dir              TEXT,
    config_overrides_json TEXT    NOT NULL DEFAULT '{}',
    limits_json           TEXT    NOT NULL DEFAULT '{}',
    -- Null means "never shut this down for being idle".
    idle_minutes          INTEGER,
    -- Who left this service stopped. `person`: a client asked, and nothing may undo it. `daemon`:
    -- MixEngine stopped it — an idle sweep, a shutdown, or a process that vanished under it. `never`:
    -- nobody has, which is also where a running service sits. On-demand activation refuses only a
    -- person's stop. NOT NULL with a third word rather than NULL for "never", because
    -- `stopped_by != 'person'` is NULL — and therefore not true — for a NULL row.
    stopped_by            TEXT    NOT NULL DEFAULT 'never'
                              CHECK (stopped_by IN ('never', 'person', 'daemon')),
    -- Milliseconds since the Unix epoch: the supervisor reads it back to decide whether a restart
    -- falls inside a crash-loop window, and sets it on every start.
    last_started_at       INTEGER,
    last_exit_code        INTEGER,
    -- The pair a survivor is adopted by: a pid alone is reused by the OS within minutes, and
    -- signalling the wrong process is exactly the accident this product cannot have.
    pid                   INTEGER,
    pid_start_time        INTEGER,

    -- Exactly one parent of three. `(x IS NOT NULL)` is 0 or 1 in SQLite, so the sum is the count.
    CHECK (((package_id IS NOT NULL)
            + (runtime_install_id IS NOT NULL)
            + (extension_id IS NOT NULL)) = 1),

    -- Three constraints rather than one over a coalesced column: SQLite treats NULLs as distinct in
    -- a UNIQUE, so each of these only ever sees the rows whose parent it names.
    UNIQUE (package_id, instance_name),
    UNIQUE (runtime_install_id, instance_name),
    UNIQUE (extension_id, instance_name)
) STRICT;

-- Projects and blueprints -----------------------------------------------------------------------

-- Before projects, which reference them.
CREATE TABLE blueprints (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    manifest_toml TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    -- builtin | captured | imported
    source        TEXT    NOT NULL,
    trusted       INTEGER NOT NULL DEFAULT 0,
    signature     TEXT
) STRICT;

CREATE TABLE projects (
    id                INTEGER PRIMARY KEY,
    name              TEXT    NOT NULL UNIQUE,
    root_path         TEXT    NOT NULL UNIQUE,
    -- {"php": "8.3.12", "node": "22.8.0"} — the pins `core::resolve` consults after mixengine.toml.
    runtime_pins_json TEXT    NOT NULL DEFAULT '{}',
    created_at        TEXT    NOT NULL,
    -- SET NULL rather than RESTRICT: a blueprint is where a project came from, not something it
    -- depends on, and deleting one must not strand the project it created.
    blueprint_id      TEXT    REFERENCES blueprints (id) ON DELETE SET NULL,
    keep_warm         INTEGER NOT NULL DEFAULT 0 CHECK (keep_warm IN (0, 1))
) STRICT;

-- Sites -----------------------------------------------------------------------------------------

CREATE TABLE sites (
    id               INTEGER PRIMARY KEY,
    -- **One of two parents.** A project's site —
    project_id       INTEGER REFERENCES projects (id) ON DELETE CASCADE,
    -- — or an extension's. CASCADE where `services.extension_id` is RESTRICT: a service is a process
    -- that may be running, a site is declared state re-rendered from the rows — and the cascade is
    -- what makes `extension_store::forget` a whole rollback and an interrupted uninstall re-runnable.
    extension_id     TEXT    REFERENCES extensions (id) ON DELETE CASCADE,
    -- Relative to the **owner's** root: `projects.root_path`, or `extensions.install_dir`.
    doc_root         TEXT    NOT NULL,
    kind             TEXT    NOT NULL
                     CHECK (kind IN ('php-fpm', 'static', 'reverse-proxy', 'node-app')),
    -- Only a php-fpm site has one, and it may outlive the pool it names being reconfigured.
    php_service_id   TEXT    REFERENCES services (id) ON DELETE SET NULL,
    https_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (https_enabled IN (0, 1)),
    http_port        INTEGER NOT NULL DEFAULT 80,
    https_port       INTEGER NOT NULL DEFAULT 443,
    config_json      TEXT    NOT NULL DEFAULT '{}',
    state            TEXT    NOT NULL DEFAULT 'enabled'
                     CHECK (state IN ('enabled', 'disabled')),
    shared_interface TEXT,
    shared_address   TEXT,
    shared_since     INTEGER,
    shared_until     INTEGER,
    -- Whether the plaintext address redirects to the HTTPS one: off unless the site asks, and never
    -- on a site that has no HTTPS to redirect to.
    https_redirect   INTEGER NOT NULL DEFAULT 0
                     CHECK (https_redirect = 0 OR https_enabled = 1),

    -- Exactly one owner.
    CHECK ((project_id IS NULL) <> (extension_id IS NULL))
) STRICT;

-- "Which sites belong to this project" — what `mix status` and the GUI's project view both ask —
-- and the path the cascade takes when a project is deleted. The other foreign keys in this schema
-- mostly have no index of their own: they are checked against tables holding a few dozen rows and
-- would buy a scan nobody can measure at the cost of a write nobody asked for.
CREATE INDEX sites_project ON sites (project_id);
CREATE UNIQUE INDEX sites_one_per_extension ON sites (extension_id) WHERE extension_id IS NOT NULL;

-- Sharing is four columns that are all there or none of them, except the deadline, which only a
-- shared site may carry. A table-level CHECK would say this too; triggers are what a later
-- `ALTER TABLE ADD COLUMN` can extend without rebuilding the table.
CREATE TRIGGER sites_sharing_is_all_or_nothing_insert
BEFORE INSERT ON sites
FOR EACH ROW
WHEN (NEW.shared_interface IS NULL) <> (NEW.shared_address IS NULL)
  OR (NEW.shared_interface IS NULL) <> (NEW.shared_since IS NULL)
  OR (NEW.shared_interface IS NULL AND NEW.shared_until IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'a shared site carries an interface, an address and a start, or none of the three — and only a shared site carries a deadline');
END;

CREATE TRIGGER sites_sharing_is_all_or_nothing_update
BEFORE UPDATE ON sites
FOR EACH ROW
WHEN (NEW.shared_interface IS NULL) <> (NEW.shared_address IS NULL)
  OR (NEW.shared_interface IS NULL) <> (NEW.shared_since IS NULL)
  OR (NEW.shared_interface IS NULL AND NEW.shared_until IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'a shared site carries an interface, an address and a start, or none of the three — and only a shared site carries a deadline');
END;

-- Every domain a site answers to, the primary one included. There is deliberately no
-- `sites.primary_domain` beside this table: two unique indexes on two tables cannot constrain each
-- other, so a primary column would leave `blog.test` free to be site A's primary *and* site B's
-- alias at the same time — the web server would then answer with whichever import it read last,
-- which is the bug a user reports as "it randomly serves the wrong project". One table means one
-- index decides who owns a domain, and it cannot disagree with itself.
CREATE TABLE site_domains (
    id         INTEGER PRIMARY KEY,
    site_id    INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    domain     TEXT    NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1))
) STRICT;

-- The one that decides ownership.
CREATE UNIQUE INDEX site_domains_domain ON site_domains (domain);

-- At most one primary per site. "At least one" is not expressible here — SQLite has no deferred
-- constraint, so the row and its site cannot both be required to exist before either is written —
-- and it stays an invariant the site module upholds inside the transaction that creates a site.
CREATE UNIQUE INDEX site_domains_one_primary_per_site
    ON site_domains (site_id) WHERE is_primary = 1;

-- Deleting a site cascades into this table by `site_id`, which the unique index above cannot serve
-- (it is keyed on `domain`); the partial index does not cover a non-primary row. Without this, each
-- delete scans every domain in the database.
CREATE INDEX site_domains_site ON site_domains (site_id);

-- Which databases and caches a site declares, so `site.start` knows what to start with it.
CREATE TABLE site_service_links (
    site_id    INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    service_id TEXT    NOT NULL REFERENCES services (id) ON DELETE CASCADE,

    PRIMARY KEY (site_id, service_id)
) STRICT;

-- The primary key answers "what does this site need" and cannot answer the reverse. "Which sites
-- are still using this service" is the question asked before stopping one, and the cascade when a
-- service is deleted takes the same path.
CREATE INDEX site_service_links_service ON site_service_links (service_id);

-- One site, many backends: a site is a kind plus an ordered set of path routes, and the kind is what
-- answers whatever no route matched. `position` is what a person typed, kept so a listing can show
-- it back; it is NOT what decides which route wins — overlaps are resolved by specificity where the
-- configuration is rendered, longest path first. `php_service_id` is SET NULL on
-- `sites.php_service_id`'s precedent, and NULL means "the pool this route named has been deleted":
-- the render skips that one route with a warning and serves the rest of the site.
CREATE TABLE site_routes (
    id             INTEGER PRIMARY KEY,
    site_id        INTEGER NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    path           TEXT    NOT NULL,
    target         TEXT    NOT NULL,
    php_service_id TEXT             REFERENCES services (id) ON DELETE SET NULL,
    config_json    TEXT    NOT NULL DEFAULT '{}',

    CONSTRAINT site_routes_target CHECK (target IN ('proxy', 'php-fpm', 'static')),

    -- The daemon refuses far more than this (a whitelist per segment, a length, dot segments); what
    -- is here is the half the schema can hold on its own, including the one the design turns on —
    -- `/` is answered by the site's kind and by nothing else.
    CONSTRAINT site_routes_path CHECK (path <> '' AND path <> '/' AND path LIKE '/%')
) STRICT;

-- One path answers once on one site. Also the index the cascade reads.
CREATE UNIQUE INDEX site_routes_site_path ON site_routes (site_id, path);

-- Certificates ----------------------------------------------------------------------------------

CREATE TABLE ca (
    id                        INTEGER PRIMARY KEY,
    fingerprint               TEXT    NOT NULL UNIQUE,
    cert_path                 TEXT    NOT NULL,
    key_path                  TEXT    NOT NULL,
    created_at                TEXT    NOT NULL,
    installed_in_trust_store  INTEGER NOT NULL DEFAULT 0
                              CHECK (installed_in_trust_store IN (0, 1))
) STRICT;

CREATE TABLE certificates (
    id                       INTEGER PRIMARY KEY,
    domain                   TEXT    NOT NULL,
    sans_json                TEXT    NOT NULL DEFAULT '[]',
    not_before               TEXT    NOT NULL,
    not_after                TEXT    NOT NULL,
    cert_path                TEXT    NOT NULL,
    key_path                 TEXT    NOT NULL,
    -- RESTRICT keeps a rotation honest: the old CA row cannot be deleted while leaves it signed are
    -- still on disk and still in a web server's configuration.
    issued_by_ca_fingerprint TEXT    NOT NULL REFERENCES ca (fingerprint) ON DELETE RESTRICT,
    revoked                  INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
) STRICT;

-- The certificate a renewal check looks up, and the one a handshake needs: the newest unrevoked
-- leaf for a domain.
CREATE INDEX certificates_domain ON certificates (domain, not_after);

-- Jobs, events and the rest ---------------------------------------------------------------------

CREATE TABLE jobs (
    id          INTEGER PRIMARY KEY,
    -- The method that produced the job — "runtime.install", "cert.issue". Not CHECKed, for the same
    -- reason `packages.name` is not: the set grows with every feature that has something long to do,
    -- and with every extension that ships one. `mixengine_proto::JobKind` is what refuses a value
    -- that is not a name.
    kind        TEXT    NOT NULL,
    -- `mixengine_proto::JobState`, spelled exactly as `JobState::as_str` writes it.
    state       TEXT    NOT NULL CHECK (state IN (
                    'running', 'succeeded', 'failed', 'cancelled')),
    percent     INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
    message     TEXT    NOT NULL DEFAULT '',
    -- Milliseconds since the Unix epoch — `mixengine_proto::Timestamp`. A job's duration is
    -- subtraction, `job.list` orders by this, and `job.wait` compares against it.
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    -- The `mixengine_proto::JobOutcome` of a finished job: null exactly while `state` is 'running'.
    -- Written in the same statement as the state it belongs to, so the two cannot disagree.
    result_json TEXT,

    -- A finished job has an ending and a moment; a running one has neither. Two nullable columns can
    -- otherwise express a third thing that never happens — a job still going with a result, or one
    -- that ended with nothing to show — and the pair would then have to be re-checked by every
    -- reader instead of once here.
    CHECK ((state = 'running') = (finished_at IS NULL)),
    CHECK ((state = 'running') = (result_json IS NULL))
) STRICT;

-- What `job.list` reads: newest first, optionally one state. The table is the one thing in this
-- schema that grows without bound — every job a home has ever run stays in it.
CREATE INDEX jobs_state_started ON jobs (state, started_at DESC);
CREATE INDEX jobs_started ON jobs (started_at DESC);

-- The audit trail behind the GUI's "recent events", trimmed to 30 days.
CREATE TABLE events (
    id           INTEGER PRIMARY KEY,
    ts           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    -- What the event is about: a site id, a service id, a domain. Free text because the subject of
    -- an event is not one kind of thing.
    subject      TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

-- Both readers go through it in time order: the trim deletes a prefix, the GUI reads a suffix.
CREATE INDEX events_ts ON events (ts);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
) STRICT;

CREATE TABLE pending_privileged_ops (
    id           INTEGER PRIMARY KEY,
    op           TEXT    NOT NULL,
    dedupe_key   TEXT    NOT NULL UNIQUE,
    -- Milliseconds since the epoch. The **first** time this operation was asked for: a conflicting
    -- insert leaves this row exactly as it is, so "pending since" reads honestly rather than
    -- resetting every time a producer retries.
    requested_at INTEGER NOT NULL
) STRICT;

-- What each subject was costing, one row per minute: a row per second would be 86,400 per subject
-- per day, and `samples` says how many readings each row is made of. `subject` is 'daemon' or
-- 'service:' followed by a service id — the prefix keeps a service called `daemon` out of the
-- daemon's own history. **No foreign key to `services`, deliberately**: a service deleted at two in
-- the morning is still the answer to what happened at two in the morning. `minute` is epoch
-- milliseconds truncated to the minute. `cpu_avg` and `cpu_peak` are nullable because a CPU figure is
-- a difference between two readings, and NULL is "not measured", never a zero.
CREATE TABLE metrics_minutes (
    subject  TEXT    NOT NULL,
    minute   INTEGER NOT NULL,
    cpu_avg  REAL,
    cpu_peak REAL,
    rss_avg  INTEGER NOT NULL,
    rss_peak INTEGER NOT NULL,
    samples  INTEGER NOT NULL CHECK (samples > 0),
    PRIMARY KEY (subject, minute)
) WITHOUT ROWID;

-- The trim deletes a prefix and a history read takes a window, both in time order; the primary key
-- orders by subject first.
CREATE INDEX metrics_minutes_minute ON metrics_minutes (minute);

-- Which home this is, so a credential in the OS store — one store per *user* — can say which
-- MIXENGINE_HOME it belongs to. **A value the home carries, not one derived from where it sits**: a
-- hash of the root path strands every credential the moment somebody renames the directory. Six
-- random bytes, generated here so a home has an identity from its first open. `DO NOTHING` so a
-- restored backup that already has one keeps it.
INSERT INTO settings (key, value_json)
VALUES ('home.id', '"' || lower(hex(randomblob(6))) || '"')
ON CONFLICT(key) DO NOTHING;

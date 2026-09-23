-- Which home this is, so a credential can say so — roadmap task **T126**.
--
-- The OS credential store is one store per **user**, and until this row a secret's address was
-- `<service-id>/<user>` — `mariadb@main/root`, with nothing in it about which MIXENGINE_HOME the
-- service belongs to. Two homes on one machine therefore shared one entry: the second home to
-- bootstrap a `mariadb@main` overwrote the first home's root password, and the first home's server
-- — which keeps its own copy in its data directory — answered every connection after that with
-- `ERROR 1045 Access denied`. Measured on a developer's machine, where a sandbox home under
-- `$TEMP` took the entry of the repository's own home at 05:55:57 and the repository's databases
-- became unreachable at 05:55:58.
--
-- **A value the home carries, not one derived from where it sits.** A hash of the root path needs
-- no row, and strands every credential the moment somebody renames the directory — which is the
-- same outage this task exists to remove, arriving for a different reason. Windows makes it worse
-- than that: case, 8.3 short names, UNC spellings and a trailing separator are four ways to write
-- one directory and four different hashes.
--
-- **Generated here rather than in Rust**, so a home has an identity from its first open and no
-- code path has to wonder whether one exists yet. Six bytes: the question it answers is *are these
-- two homes the same one*, over the handful a machine has, and 48 bits settles it.
--
-- `DO NOTHING` because this migration must be able to run on a home that already has an id — a
-- restored backup replayed against a newer build — without minting a second one and orphaning
-- every credential written under the first.
INSERT INTO settings (key, value_json)
VALUES ('home.id', '"' || lower(hex(randomblob(6))) || '"')
ON CONFLICT(key) DO NOTHING;

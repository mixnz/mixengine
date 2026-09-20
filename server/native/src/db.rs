//! One SQLite file, a small pool of connections, and the schema.
//!
//! **This is where the two implementations genuinely differ.** The Worker keeps one account per
//! Durable Object, where execution is serialized, so the registration race, the monotonic `seq` and
//! the per-record compare-and-swap are correct without a transaction being written. Here every
//! account is a row in one file and several requests are in flight at once, so each of those three
//! is a `BEGIN IMMEDIATE` written by hand — and each one carries a comment naming the guarantee it
//! is standing in for.
//!
//! Neither difference is visible through `/v1`, which is the claim `../conformance/` exists to
//! check.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

/// How many connections are kept. SQLite in WAL mode takes many readers and one writer, so this
/// buys real concurrency for the reads — which is what makes the transactions below load-bearing
/// rather than decorative.
const POOL: usize = 4;

pub struct Db {
    path: String,
    idle: Mutex<Vec<Connection>>,
}

impl Db {
    pub fn open(path: &str) -> rusqlite::Result<Arc<Self>> {
        let db = Arc::new(Self {
            path: path.to_owned(),
            idle: Mutex::new(Vec::with_capacity(POOL)),
        });
        let connection = db.connect()?;
        connection.execute_batch(SCHEMA)?;
        db.give(connection);
        Ok(db)
    }

    fn connect(&self) -> rusqlite::Result<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.execute_batch(
            // WAL so a reader never blocks the writer, and a busy timeout so a writer that arrives
            // mid-transaction waits rather than failing the request it was serving.
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(connection)
    }

    fn take(&self) -> rusqlite::Result<Connection> {
        if let Some(connection) = self.idle.lock().expect("the pool lock is poisoned").pop() {
            return Ok(connection);
        }
        self.connect()
    }

    fn give(&self, connection: Connection) {
        let mut idle = self.idle.lock().expect("the pool lock is poisoned");
        if idle.len() < POOL {
            idle.push(connection);
        }
    }

    /// Runs one piece of database work off the async runtime. `rusqlite` is synchronous, and a
    /// blocking call on a runtime thread stalls every other request sharing it.
    pub async fn call<T, F>(self: &Arc<Self>, work: F) -> rusqlite::Result<T>
    where
        F: FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let mut connection = db.take()?;
            let outcome = work(&mut connection);
            db.give(connection);
            outcome
        })
        .await
        .expect("a database task panicked")
    }
}

/// The tables. One file holds every account, which is the shape D8 names as the fallback if
/// Durable Objects ever stop being free — so the two halves of this repository already prove that
/// the protocol survives it.
pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS account (
  id                   INTEGER PRIMARY KEY,
  email                TEXT    NOT NULL UNIQUE,
  verifier             TEXT    NOT NULL,
  salt_account         TEXT    NOT NULL,
  argon_m              INTEGER NOT NULL,
  argon_t              INTEGER NOT NULL,
  argon_p              INTEGER NOT NULL,
  wrapped_mk_password  TEXT    NOT NULL,
  wrapped_mk_recovery  TEXT    NOT NULL,
  verified             INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  next_seq             INTEGER NOT NULL DEFAULT 0,
  stored_bytes         INTEGER NOT NULL DEFAULT 0,
  reaped_below_seq     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS device (
  id            TEXT    PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

-- Tokens are stored as their SHA-256 and never in the clear: a database read is not a list of
-- credentials. `rotated` is kept rather than deleted, because a rotated refresh token coming back
-- is the one signal this design gets for free that a token has been copied.
CREATE TABLE IF NOT EXISTS token (
  hash        TEXT    PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  device_id   TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  rotated     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS token_by_device ON token (device_id);

CREATE TABLE IF NOT EXISTS mail_token (
  hash        TEXT    PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

-- Only ever written in test-outbox mode, which is refused unless the server was started with it
-- deliberately. It exists because no HTTP suite can read an inbox.
CREATE TABLE IF NOT EXISTS outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  token       TEXT    NOT NULL,
  sent_at     INTEGER NOT NULL
);

-- The record table of D3. Both halves of the address are opaque — 32 bytes of keyed hash each — so
-- this table can be read end to end without learning what kind of thing any row is.
CREATE TABLE IF NOT EXISTS record (
  account_id  INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  collection  TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  nonce       TEXT,
  ciphertext  TEXT,
  bytes       INTEGER NOT NULL DEFAULT 0,
  written_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, collection, id)
);
CREATE INDEX IF NOT EXISTS record_by_seq ON record (account_id, seq);

-- Guessing at one account, counted against that account.
CREATE TABLE IF NOT EXISTS attempt (
  account_id  INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  action      TEXT    NOT NULL,
  count       INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, action)
);

-- Opening many accounts is a different abuse, and a counter kept per account cannot see it.
CREATE TABLE IF NOT EXISTS source_window (
  source      TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  count       INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  PRIMARY KEY (source, action)
);
"#;

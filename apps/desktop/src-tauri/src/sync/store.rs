//! What this machine remembers about sync, so a pull resumes and a push can say `If-Match`.
//!
//! Two things, both kept **per server**: the cursor each collection has read up to, and the
//! version of each record this machine last saw. Per server because the same opaque ids mean
//! nothing on another one — a different server is a different account (D8). Nothing here is
//! plaintext: every collection and id is the opaque HMAC of D3.

use std::path::Path;
use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use super::wire::WireRecord;
use crate::error::AppError;

const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS cursor (
       server     TEXT    NOT NULL,
       collection TEXT    NOT NULL,
       since      INTEGER NOT NULL,
       PRIMARY KEY (server, collection)
     )",
    "CREATE TABLE IF NOT EXISTS seen (
       server     TEXT    NOT NULL,
       collection TEXT    NOT NULL,
       id         TEXT    NOT NULL,
       version    INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       deleted    INTEGER NOT NULL,
       -- What this machine and the server last agreed a record says: the local id it is known by
       -- here, and a hash of its canonical plaintext. Absent until a change has landed (D4).
       local_id   TEXT,
       hash       TEXT,
       PRIMARY KEY (server, collection, id)
     )",
];

/// What this machine last saw of one record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seen {
    pub version: i64,
    pub updated_at: i64,
    pub deleted: bool,
}

/// What this machine and the server last agreed a record says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agreed {
    pub local_id: String,
    pub hash: String,
}

pub struct Store {
    pool: SqlitePool,
    server: String,
}

impl Store {
    pub async fn open(path: &Path, server: &str) -> Result<Self, AppError> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        Self::with(options, server).await
    }

    /// A store that lives as long as the value does — for tests.
    pub async fn in_memory(server: &str) -> Result<Self, AppError> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:").map_err(store_error)?;
        Self::with(options, server).await
    }

    /// One connection: an in-memory database is per connection, and a file needs no more.
    async fn with(options: SqliteConnectOptions, server: &str) -> Result<Self, AppError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(store_error)?;
        // Each is a literal: sqlx 0.9 accepts only a `&'static str` without an audit wrapper.
        for statement in SCHEMA {
            sqlx::query(*statement)
                .execute(&pool)
                .await
                .map_err(store_error)?;
        }
        Ok(Self {
            pool,
            server: server.to_owned(),
        })
    }

    /// Where a pull of `collection` resumes. `0` is the beginning.
    pub async fn since(&self, collection: &str) -> Result<i64, AppError> {
        let row = sqlx::query("SELECT since FROM cursor WHERE server = ?1 AND collection = ?2")
            .bind(&self.server)
            .bind(collection)
            .fetch_optional(&self.pool)
            .await
            .map_err(store_error)?;
        Ok(row.map(|row| row.get::<i64, _>(0)).unwrap_or(0))
    }

    pub async fn set_since(&self, collection: &str, since: i64) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO cursor (server, collection, since) VALUES (?1, ?2, ?3)
             ON CONFLICT (server, collection) DO UPDATE SET since = excluded.since",
        )
        .bind(&self.server)
        .bind(collection)
        .bind(since)
        .execute(&self.pool)
        .await
        .map_err(store_error)?;
        Ok(())
    }

    pub async fn seen(&self, collection: &str, id: &str) -> Result<Option<Seen>, AppError> {
        let row = sqlx::query(
            "SELECT version, updated_at, deleted FROM seen
             WHERE server = ?1 AND collection = ?2 AND id = ?3",
        )
        .bind(&self.server)
        .bind(collection)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(store_error)?;
        Ok(row.map(|row| Seen {
            version: row.get(0),
            updated_at: row.get(1),
            deleted: row.get::<i64, _>(2) == 1,
        }))
    }

    /// Remember the version the server holds, so the next write can say `If-Match` with it.
    pub async fn remember(&self, record: &WireRecord) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO seen (server, collection, id, version, updated_at, deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (server, collection, id) DO UPDATE SET
               version = excluded.version, updated_at = excluded.updated_at,
               deleted = excluded.deleted",
        )
        .bind(&self.server)
        .bind(&record.collection)
        .bind(&record.id)
        .bind(record.version)
        .bind(record.updated_at)
        .bind(i64::from(record.deleted))
        .execute(&self.pool)
        .await
        .map_err(store_error)?;
        Ok(())
    }

    /// The cursor back to the start and every remembered version gone: what `410 cursor-expired`
    /// asks for — D3's *resync from empty rather than incomplete news quietly*.
    pub async fn forget(&self, collection: &str) -> Result<(), AppError> {
        for statement in [
            "DELETE FROM cursor WHERE server = ?1 AND collection = ?2",
            "DELETE FROM seen WHERE server = ?1 AND collection = ?2",
        ] {
            sqlx::query(statement)
                .bind(&self.server)
                .bind(collection)
                .execute(&self.pool)
                .await
                .map_err(store_error)?;
        }
        Ok(())
    }

    pub async fn agreed(&self, collection: &str, id: &str) -> Result<Option<Agreed>, AppError> {
        let row = sqlx::query(
            "SELECT local_id, hash FROM seen
             WHERE server = ?1 AND collection = ?2 AND id = ?3
               AND local_id IS NOT NULL AND hash IS NOT NULL",
        )
        .bind(&self.server)
        .bind(collection)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(store_error)?;
        Ok(row.map(|row| Agreed {
            local_id: row.get(0),
            hash: row.get(1),
        }))
    }

    /// Record agreement **once the change it describes has landed** — never before, or a write
    /// that failed afterwards would read as agreed and be pushed back over something newer.
    pub async fn agree(
        &self,
        collection: &str,
        id: &str,
        local_id: &str,
        hash: &str,
    ) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE seen SET local_id = ?4, hash = ?5
             WHERE server = ?1 AND collection = ?2 AND id = ?3",
        )
        .bind(&self.server)
        .bind(collection)
        .bind(id)
        .bind(local_id)
        .bind(hash)
        .execute(&self.pool)
        .await
        .map_err(store_error)?;
        Ok(())
    }

    /// Every record in `collection` this machine agreed on that is not a tombstone, as
    /// `(opaque id, local id)`: what a reader must still return, or it was deleted here.
    pub async fn agreed_live(&self, collection: &str) -> Result<Vec<(String, String)>, AppError> {
        let rows = sqlx::query(
            "SELECT id, local_id FROM seen
             WHERE server = ?1 AND collection = ?2 AND deleted = 0 AND local_id IS NOT NULL",
        )
        .bind(&self.server)
        .bind(collection)
        .fetch_all(&self.pool)
        .await
        .map_err(store_error)?;
        Ok(rows.iter().map(|row| (row.get(0), row.get(1))).collect())
    }
}

fn store_error(error: sqlx::Error) -> AppError {
    err!("error.syncStoreFailed", message = error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(collection: &str, id: &str, version: i64) -> WireRecord {
        WireRecord {
            collection: collection.into(),
            id: id.into(),
            version,
            seq: version,
            updated_at: 100 + version,
            deleted: false,
            device: "d".into(),
            nonce: Some("n".into()),
            ciphertext: Some("x".into()),
        }
    }

    #[tokio::test]
    async fn a_new_collection_starts_at_the_beginning() {
        let store = Store::in_memory("https://a").await.unwrap();
        assert_eq!(store.since("c").await.unwrap(), 0);
        store.set_since("c", 42).await.unwrap();
        assert_eq!(store.since("c").await.unwrap(), 42);
    }

    #[tokio::test]
    async fn the_latest_version_seen_is_the_one_remembered() {
        let store = Store::in_memory("https://a").await.unwrap();
        assert_eq!(store.seen("c", "i").await.unwrap(), None);
        store.remember(&record("c", "i", 1)).await.unwrap();
        store.remember(&record("c", "i", 2)).await.unwrap();
        assert_eq!(
            store.seen("c", "i").await.unwrap(),
            Some(Seen {
                version: 2,
                updated_at: 102,
                deleted: false
            })
        );
    }

    #[tokio::test]
    async fn forgetting_a_collection_leaves_the_others() {
        let store = Store::in_memory("https://a").await.unwrap();
        store.set_since("c", 9).await.unwrap();
        store.set_since("other", 7).await.unwrap();
        store.remember(&record("c", "i", 1)).await.unwrap();
        store.forget("c").await.unwrap();
        assert_eq!(store.since("c").await.unwrap(), 0);
        assert_eq!(store.seen("c", "i").await.unwrap(), None);
        assert_eq!(store.since("other").await.unwrap(), 7);
    }

    /// **A different server is a different account.** Its cursor and versions are not this one's.
    #[tokio::test]
    async fn two_servers_share_nothing() {
        let path = std::env::temp_dir().join(format!("sync-store-{}.db", uuid::Uuid::new_v4()));
        let a = Store::open(&path, "https://a").await.unwrap();
        a.set_since("c", 5).await.unwrap();
        a.remember(&record("c", "i", 3)).await.unwrap();
        drop(a);

        let b = Store::open(&path, "https://b").await.unwrap();
        assert_eq!(b.since("c").await.unwrap(), 0);
        assert_eq!(b.seen("c", "i").await.unwrap(), None);
        drop(b);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn agreement_is_kept_by_remember_and_read_back() {
        let store = Store::in_memory("s").await.unwrap();
        store.remember(&record("c", "i", 1)).await.unwrap();
        assert_eq!(store.agreed("c", "i").await.unwrap(), None);
        store.agree("c", "i", "local-1", "h1").await.unwrap();
        store.remember(&record("c", "i", 2)).await.unwrap();
        assert_eq!(
            store.agreed("c", "i").await.unwrap(),
            Some(Agreed {
                local_id: "local-1".into(),
                hash: "h1".into()
            })
        );
    }

    #[tokio::test]
    async fn a_tombstone_is_not_live() {
        let store = Store::in_memory("s").await.unwrap();
        store.remember(&record("c", "a", 1)).await.unwrap();
        store.remember(&record("c", "b", 1)).await.unwrap();
        store.agree("c", "a", "la", "h").await.unwrap();
        store.agree("c", "b", "lb", "h").await.unwrap();
        let mut dead = record("c", "b", 2);
        dead.deleted = true;
        store.remember(&dead).await.unwrap();
        assert_eq!(
            store.agreed_live("c").await.unwrap(),
            vec![("a".into(), "la".into())]
        );
    }
}

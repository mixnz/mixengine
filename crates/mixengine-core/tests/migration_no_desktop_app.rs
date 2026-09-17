//! What `0024_no_desktop_app_extensions.sql` removes — roadmap task **T165**.
//!
//! `desktop-app` stopped being an extension kind (ADR 0038). A home that installed one still holds
//! its row, and the reader this build carries cannot read that row's manifest, so the migration
//! deletes it before anything opens the table. Every other extension is left exactly as it was.
//!
//! Seeded between two migrations on `migration_stopped_by.rs`' pattern, on one connection because
//! `PRAGMA foreign_keys` is per-connection.

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions as _, SqliteConnection};
use tempfile::TempDir;

/// The version this task adds, and the line the seeding happens on.
const NO_DESKTOP_APP: i64 = 24;

/// A fresh database migrated up to but not including [`NO_DESKTOP_APP`], foreign keys enforced.
async fn migrated_to_the_previous_version() -> (TempDir, SqliteConnection) {
    let temp = TempDir::new().expect("a temporary directory");

    let mut connection = SqliteConnectOptions::new()
        .filename(temp.path().join("mixengine.db"))
        .create_if_missing(true)
        .foreign_keys(true)
        .connect()
        .await
        .expect("a database");

    for migration in sqlx::migrate!("./migrations")
        .iter()
        .filter(|migration| migration.version < NO_DESKTOP_APP)
    {
        sqlx::raw_sql(migration.sql.clone())
            .execute(&mut connection)
            .await
            .unwrap_or_else(|error| panic!("migration {}: {error}", migration.version));
    }

    (temp, connection)
}

/// Apply the migration under test.
async fn apply(connection: &mut SqliteConnection) {
    let migration = sqlx::migrate!("./migrations")
        .iter()
        .find(|migration| migration.version == NO_DESKTOP_APP)
        .expect("0024 exists")
        .clone();

    sqlx::raw_sql(migration.sql.clone())
        .execute(connection)
        .await
        .expect("the no-desktop-app migration");
}

/// One installed extension row of `kind`.
async fn extension(connection: &mut SqliteConnection, id: &str, kind: &str) {
    sqlx::query(
        "INSERT INTO extensions
             (id, name, version, kind, manifest_json, install_dir, data_dir, source, signed,
              installed_at)
         VALUES (?, ?, '1.0.0', ?, '{}', '/extensions/x', '/data/extensions/x', 'registry', 1,
                 '2026-09-17T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(kind)
    .execute(&mut *connection)
    .await
    .expect("an extension row");
}

/// Every extension id left, sorted.
async fn ids(connection: &mut SqliteConnection) -> Vec<String> {
    sqlx::query_scalar("SELECT id FROM extensions ORDER BY id")
        .fetch_all(connection)
        .await
        .expect("the ids")
}

/// **The `desktop-app` row goes, and nothing else does.**
#[tokio::test]
async fn a_desktop_app_row_is_removed_and_every_other_kind_stays() {
    let (_temp, mut connection) = migrated_to_the_previous_version().await;

    extension(&mut connection, "mixdb", "desktop-app").await;
    extension(&mut connection, "mailpit", "service").await;
    extension(&mut connection, "adminer", "web-app").await;
    extension(&mut connection, "sendmail", "recipe").await;

    apply(&mut connection).await;

    assert_eq!(
        ids(&mut connection).await,
        ["adminer", "mailpit", "sendmail"]
    );
}

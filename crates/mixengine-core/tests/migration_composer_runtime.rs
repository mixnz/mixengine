//! What widening `runtime_installs.kind` must not lose — roadmap task **T27c**, the design's D2.
//!
//! `0019_composer_runtime.sql` rebuilds a table that holds rows on every developer's machine and
//! that `services.runtime_install_id` references with `ON DELETE RESTRICT`. Seeded between two
//! migrations on `migration_extensions.rs`' pattern, on one connection because `PRAGMA foreign_keys`
//! is per-connection.

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions as _, SqliteConnection};
use tempfile::TempDir;

/// The version this task adds.
const COMPOSER_RUNTIME: i64 = 19;

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
        .filter(|migration| migration.version < COMPOSER_RUNTIME)
    {
        sqlx::raw_sql(migration.sql.clone())
            .execute(&mut connection)
            .await
            .unwrap_or_else(|error| panic!("migration {}: {error}", migration.version));
    }

    (temp, connection)
}

async fn apply_the_composer_migration(connection: &mut SqliteConnection) {
    let migration = sqlx::migrate!("./migrations")
        .iter()
        .find(|migration| migration.version == COMPOSER_RUNTIME)
        .expect("0019 exists")
        .clone();

    sqlx::raw_sql(migration.sql.clone())
        .execute(connection)
        .await
        .expect("the composer migration");
}

/// Two runtimes, one of them the default PHP, and the pool that references that PHP.
async fn seed(connection: &mut SqliteConnection) {
    for statement in [
        "INSERT INTO runtime_installs (kind, version, channel, install_path, installed_at,
            size_bytes, source_url, sha256, is_default, provides_json)
         VALUES ('php', '8.3.33', 'stable', '/runtimes/php/8.3.33', '2026-08-11T09:00:00Z', 1,
            'https://example.invalid/php.tar.zst', 'ab', 1, '{\"php\": \"bin/php\"}')",
        "INSERT INTO runtime_installs (kind, version, channel, install_path, installed_at,
            size_bytes, source_url, sha256, is_default, provides_json)
         VALUES ('node', '22.23.2', 'stable', '/runtimes/node/22.23.2', '2026-08-11T09:00:00Z', 1,
            'https://example.invalid/node.tar.zst', 'cd', 0, '{}')",
        "INSERT INTO services (id, runtime_install_id, instance_name, state, port)
         VALUES ('php-fpm@8.3.33', 1, '8.3.33', 'stopped', 9000)",
    ] {
        sqlx::query(statement)
            .execute(&mut *connection)
            .await
            .unwrap_or_else(|error| panic!("{statement}: {error}"));
    }
}

/// Every row, the default flag, and the pool's reference survive the rebuild; the column now takes
/// `composer`; and the two things the rebuild could have silently dropped — the one-default index
/// and the `CHECK` itself — are still there.
#[tokio::test]
async fn the_rebuild_keeps_every_row_the_default_and_the_pool_and_admits_composer() {
    let (_temp, mut connection) = migrated_to_the_previous_version().await;
    seed(&mut connection).await;

    apply_the_composer_migration(&mut connection).await;

    let rows: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT kind, version, is_default FROM runtime_installs ORDER BY id")
            .fetch_all(&mut connection)
            .await
            .expect("the rows");
    assert_eq!(
        rows,
        vec![
            ("php".to_owned(), "8.3.33".to_owned(), 1),
            ("node".to_owned(), "22.23.2".to_owned(), 0),
        ]
    );

    let pool: (i64,) =
        sqlx::query_as("SELECT runtime_install_id FROM services WHERE id = 'php-fpm@8.3.33'")
            .fetch_one(&mut connection)
            .await
            .expect("the pool still points at its runtime");
    assert_eq!(pool.0, 1);

    sqlx::query(
        "INSERT INTO runtime_installs (kind, version, channel, install_path, installed_at,
            size_bytes, source_url, sha256, provides_json)
         VALUES ('composer', '2.10.3', 'stable', '/runtimes/composer/2.10.3',
            '2026-09-08T09:00:00Z', 1, 'https://example.invalid/composer.zip', 'ef',
            '{\"composer\": \"composer.phar\"}')",
    )
    .execute(&mut connection)
    .await
    .expect("composer is a kind now");

    // The partial unique index came back with the table: a second default of one kind is refused.
    let refused = sqlx::query(
        "INSERT INTO runtime_installs (kind, version, channel, install_path, installed_at,
            size_bytes, source_url, sha256, is_default, provides_json)
         VALUES ('php', '8.4.1', 'stable', '/runtimes/php/8.4.1', '2026-09-08T09:00:00Z', 1,
            'https://example.invalid/php84.tar.zst', '01', 1, '{}')",
    )
    .execute(&mut connection)
    .await;
    assert!(refused.is_err(), "two defaults for php");

    // And a word nothing knows is still refused.
    let refused = sqlx::query(
        "INSERT INTO runtime_installs (kind, version, channel, install_path, installed_at,
            size_bytes, source_url, sha256, provides_json)
         VALUES ('perl', '5.40.0', 'stable', '/runtimes/perl/5.40.0', '2026-09-08T09:00:00Z', 1,
            'https://example.invalid/perl.tar.zst', '02', '{}')",
    )
    .execute(&mut connection)
    .await;
    assert!(refused.is_err(), "the CHECK is still a CHECK");
}

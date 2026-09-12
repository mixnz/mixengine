//! What `idle_stopped` becomes when it grows a third answer — roadmap task **T123**.
//!
//! `0020_service_stopped_by.sql` replaces a boolean with a word, and the interesting part is the
//! rows that were already there: the old column cannot say whether an `idle_stopped = 0` row is a
//! person's stop or a service that never ran, and reading every one of them as a person's is what
//! would carry this bug across the upgrade instead of fixing it. `last_started_at` is what tells the
//! two apart.
//!
//! It is also the third migration in this tree to rebuild `services`, and two tables point at it:
//! `sites.php_service_id` is `ON DELETE SET NULL` and `site_service_links.service_id` is `ON DELETE
//! CASCADE`, so a drop with foreign keys enforced would quietly empty one and delete from the other.
//! `migration_extensions.rs` argues that at length for 0016; this proves it again for 0020, because
//! the guarantee belongs to each rebuild rather than to the first one.
//!
//! **These tests seed between two migrations**, which is why they apply them by hand rather than
//! through `Store::open`: a database migrated in one go has no rows for the interesting question to
//! be about. Everything runs on a single connection because `PRAGMA foreign_keys` is per-connection,
//! and the migration's own pragma is worth nothing if the statement after it lands somewhere else.

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions as _, SqliteConnection};
use tempfile::TempDir;

/// The version this task adds, and the line the seeding happens on.
const STOPPED_BY: i64 = 20;

/// A connection to a fresh database, migrated up to but not including [`STOPPED_BY`].
///
/// Foreign keys are enforced exactly as `Store` enforces them, because a migration that only works
/// with them off is one that works nowhere real.
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
        .filter(|migration| migration.version < STOPPED_BY)
    {
        sqlx::raw_sql(migration.sql.clone())
            .execute(&mut connection)
            .await
            .unwrap_or_else(|error| panic!("migration {}: {error}", migration.version));
    }

    (temp, connection)
}

/// Apply the migration under test.
async fn apply_the_stopped_by_migration(connection: &mut SqliteConnection) {
    let migration = sqlx::migrate!("./migrations")
        .iter()
        .find(|migration| migration.version == STOPPED_BY)
        .expect("0020 exists")
        .clone();

    sqlx::raw_sql(migration.sql.clone())
        .execute(connection)
        .await
        .expect("the stopped_by migration");
}

/// One service row, in the shape the old column could leave it in.
async fn service(
    connection: &mut SqliteConnection,
    id: &str,
    state: &str,
    idle_stopped: i64,
    last_started_at: Option<i64>,
) {
    sqlx::query(
        "INSERT INTO packages (name, version, install_path, installed_at, source_url, sha256)
         VALUES (?, '1.0.0', '/packages/x', '2026-08-11T09:00:00Z', 'https://example.invalid', 'ab')",
    )
    .bind(id)
    .execute(&mut *connection)
    .await
    .expect("a package for the service to belong to");

    sqlx::query(
        "INSERT INTO services (id, package_id, instance_name, state, idle_stopped, last_started_at)
         VALUES (?, (SELECT id FROM packages WHERE name = ?), 'main', ?, ?, ?)",
    )
    .bind(id)
    .bind(id)
    .bind(state)
    .bind(idle_stopped)
    .bind(last_started_at)
    .execute(&mut *connection)
    .await
    .expect("a service");
}

/// What the column says after the upgrade.
async fn stopped_by(connection: &mut SqliteConnection, id: &str) -> String {
    sqlx::query_scalar("SELECT stopped_by FROM services WHERE id = ?")
        .bind(id)
        .fetch_one(connection)
        .await
        .expect("the row")
}

/// **The four shapes an old row could be in, each read for what it actually was.**
///
/// The two that matter are the middle ones: a row that never ran and a row the machine left behind
/// both carried `idle_stopped = 0`, and both would come out of a naive upgrade unwakeable.
#[tokio::test]
async fn the_old_column_is_read_for_what_it_could_and_could_not_say() {
    let (_temp, mut connection) = migrated_to_the_previous_version().await;

    // The daemon idled it: the one case the old column could state outright.
    service(&mut connection, "idled", "stopped", 1, Some(1_760_000_000)).await;

    // Never ran. `service.create` writes exactly this, and so does a pool a runtime install made.
    service(&mut connection, "fresh", "stopped", 0, None).await;

    // Ran, and was stopped by something that was not the idle sweep. Left as a person's, because
    // waking a service somebody deliberately stopped is the one mistake here that cannot be undone
    // by waiting.
    service(
        &mut connection,
        "stopped",
        "stopped",
        0,
        Some(1_760_000_000),
    )
    .await;

    // Running, where the old column meant nothing at all.
    service(&mut connection, "up", "running", 0, Some(1_760_000_000)).await;

    apply_the_stopped_by_migration(&mut connection).await;

    assert_eq!(stopped_by(&mut connection, "idled").await, "daemon");
    assert_eq!(
        stopped_by(&mut connection, "fresh").await,
        "never",
        "a service that had never run was upgraded into one somebody had stopped"
    );
    assert_eq!(stopped_by(&mut connection, "stopped").await, "person");
    assert_eq!(
        stopped_by(&mut connection, "up").await,
        "never",
        "a running service carries a stop that is not happening"
    );
}

/// **Everything pointing at `services` still points at it afterwards.**
///
/// The link row is the one worth the test: a cascade would take it with no trace left anywhere a
/// person would look.
#[tokio::test]
async fn the_rebuild_keeps_what_points_at_services() {
    let (_temp, mut connection) = migrated_to_the_previous_version().await;

    service(&mut connection, "mariadb", "stopped", 0, None).await;

    sqlx::query(
        "INSERT INTO projects (name, root_path, created_at)
         VALUES ('blog', '/home/dev/blog', '2026-08-11T09:00:00Z')",
    )
    .execute(&mut connection)
    .await
    .expect("a project");

    sqlx::query(
        "INSERT INTO sites (project_id, doc_root, kind, php_service_id, state)
         VALUES (1, '/home/dev/blog/public', 'php-fpm', 'mariadb', 'enabled')",
    )
    .execute(&mut connection)
    .await
    .expect("a site");

    sqlx::query("INSERT INTO site_service_links (site_id, service_id) VALUES (1, 'mariadb')")
        .execute(&mut connection)
        .await
        .expect("a link");

    apply_the_stopped_by_migration(&mut connection).await;

    let pool: Option<String> = sqlx::query_scalar("SELECT php_service_id FROM sites WHERE id = 1")
        .fetch_one(&mut connection)
        .await
        .expect("the site");
    assert_eq!(
        pool.as_deref(),
        Some("mariadb"),
        "the site lost the service it names"
    );

    let links: i64 = sqlx::query_scalar("SELECT count(*) FROM site_service_links")
        .fetch_one(&mut connection)
        .await
        .expect("a count");
    assert_eq!(
        links, 1,
        "a cascade took the link with nothing to show for it"
    );
}

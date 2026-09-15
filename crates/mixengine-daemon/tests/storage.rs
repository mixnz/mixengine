//! The four relocation flags, against real `mixengined` processes — roadmap task **T144**.
//!
//! These cannot be written any other way. What the flags claim is about a **start**: that a value
//! reaches `config.toml` and then reaches `Paths`, that repeating it changes nothing, and that a
//! start which may not honour it stops rather than continuing with data somewhere else. The first
//! and the last are exit statuses of a process, and the middle one is a file two processes looked
//! at.
//!
//! Every test gets its own `MIXENGINE_HOME` in a `TempDir` **passed as `--home`** — rule 2 in
//! `.claude/standards/testing.md`. Nothing here touches the network.

use std::process::Command;

use mixengine_core::config;
use mixengine_testkit::{Home, stop};

/// Run `mixengined` against `home` with the given arguments, to completion.
///
/// `lifecycle.rs`' helper, restated rather than shared for its stated reason: `CARGO_BIN_EXE_…`
/// reaches binaries of this package alone, so it cannot live in the testkit.
fn run(home: &Home, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mixengined"))
        .args(args)
        .arg("--home")
        .arg(home.path())
        .output()
        .expect("the daemon binary runs")
}

/// Start a daemon with `args`, wait until it is listening, then stop it.
///
/// Returns what `--detach` said, so a caller may assert on a start that failed.
async fn started_and_stopped(home: &Home, args: &[&str]) -> std::process::Output {
    let mut all = vec!["--detach"];
    all.extend_from_slice(args);

    let output = run(home, &all);

    if output.status.success()
        && let Some(pid) = home.locked_by()
    {
        stop(pid);
        home.wait_until_gone().await;
    }

    output
}

/// What `config.toml` says now.
fn paths_of(home: &Home) -> config::PathOverrides {
    config::load(&home.path().join(config::FILE_NAME))
        .expect("the home's configuration parses")
        .paths
}

/// The file, byte for byte.
fn config_text(home: &Home) -> String {
    std::fs::read_to_string(home.path().join(config::FILE_NAME)).expect("the file is readable")
}

/// A value reaches `config.toml`, and the directory it names is created.
#[tokio::test]
async fn a_flag_moves_a_directory_and_the_file_remembers() {
    let home = Home::new();
    let bulk = tempfile::tempdir().expect("somewhere to move things to");
    let data = bulk.path().join("data");

    let output = started_and_stopped(&home, &["--data", &data.display().to_string()]).await;

    assert!(
        output.status.success(),
        "--data refused a start it should have taken — {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(paths_of(&home).data, Some(data.clone()));
    assert!(
        data.is_dir(),
        "the daemon bootstrapped the home again after writing the new layout"
    );
    assert!(
        !home.path().join("data").exists(),
        "the empty default `data/` was left in the home beside the chosen one"
    );
}

/// **The silent no-op.** A launchd plist carries its flags for the life of the plist, so the second
/// start with the same value has to write nothing at all — not even a rewrite that happens to say
/// the same thing, which would be a file whose modification time moves at every boot.
#[tokio::test]
async fn starting_again_with_the_same_flag_rewrites_nothing() {
    let home = Home::new();
    let bulk = tempfile::tempdir().expect("somewhere to move things to");
    let data = bulk.path().join("data").display().to_string();

    started_and_stopped(&home, &["--data", &data]).await;
    let after_first = config_text(&home);

    let output = started_and_stopped(&home, &["--data", &data]).await;

    assert!(
        output.status.success(),
        "the second start refused the flag it was already running with — {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(config_text(&home), after_first);
}

/// A relative value is relative to the home, which is what `[paths]` promises about the same string.
#[tokio::test]
async fn a_relative_value_lands_under_the_home() {
    let home = Home::new();

    let output = started_and_stopped(&home, &["--packages", "bulk/packages"]).await;

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        paths_of(&home).packages,
        Some(std::path::PathBuf::from("bulk/packages")),
        "the file keeps what was written rather than what it resolves to"
    );
    assert!(home.path().join("bulk").join("packages").is_dir());
}

/// **A value this build refuses is refused before the daemon is listening**, and the sentence is
/// the one `config.toml` itself would have produced.
#[tokio::test]
async fn a_value_the_configuration_would_refuse_stops_the_start() {
    let home = Home::new();
    let before = config_text(&home);

    // **In the foreground, deliberately.** A `--detach` start reports a child that stopped as
    // "logs/daemon.log says why" — the parent never held the child's stderr — so a test about what
    // the refusal *says* has to be the process that says it.
    let output = run(&home, &["--data", ".."]);

    assert!(!output.status.success(), "`--data ..` started a daemon");

    let complaint = String::from_utf8_lossy(&output.stderr);
    assert!(complaint.contains("data"), "{complaint}");
    assert_eq!(config_text(&home), before, "a refused value was written");
}

/// **The third outcome.** Once something is installed the location is in a row, so a differing
/// value fails the start rather than being ignored — and says what is installed and where to look.
#[tokio::test]
async fn a_move_after_an_install_stops_the_start_and_names_what_is_there() {
    let home = Home::new();
    let bulk = tempfile::tempdir().expect("somewhere to move things to");

    // A first start, to create the database this row goes into.
    started_and_stopped(&home, &[]).await;

    let store = mixengine_core::Store::open(&home.path().join("mixengine.db"))
        .await
        .expect("the home's database");
    sqlx::query(
        "INSERT INTO runtime_installs
             (kind, version, channel, install_path, installed_at, size_bytes, source_url, sha256)
         VALUES ('php', '8.3.12', 'stable', '/old/runtimes/php/8.3.12', '2026-09-16', 1,
                 'https://example.invalid/php.tar.gz', 'abc')",
    )
    .execute(store.pool())
    .await
    .expect("the row");
    store.close().await;

    let before = config_text(&home);
    let output = run(
        &home,
        &["--data", &bulk.path().join("data").display().to_string()],
    );

    assert!(
        !output.status.success(),
        "a daemon started and moved data/ out from under an installed runtime"
    );

    let complaint = String::from_utf8_lossy(&output.stderr);
    assert!(
        complaint.contains("1 runtime is installed"),
        "the refusal has to name what is there: {complaint}"
    );
    assert!(
        complaint.contains(config::FILE_NAME),
        "and where to change it by hand: {complaint}"
    );
    assert_eq!(config_text(&home), before, "a refused start wrote the file");
}

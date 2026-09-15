//! `mix storage` — where a home's growing directories are, asked without a daemon.
//!
//! **The claim these tests hold is that no daemon is involved.** `mix` links neither
//! `mixengine-core` nor `sqlx`, so the answer comes from running `mixengined` once; what has to be
//! true is that asking starts nothing, creates nothing, and renders what the other binary said
//! rather than a second opinion. Roadmap task **T145**.

use std::process::Command;

mod harness;

/// Run `mix` against `home`, with the daemon binary built beside it.
///
/// `MIXENGINE_DAEMON_BIN` is how a `mix` in `target/debug` is told which `mixengined` to run — the
/// variable `autostart.rs` reads first, and the reason it exists.
fn mix(home: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mix"))
        .env("MIXENGINE_DAEMON_BIN", harness::daemon_binary())
        .args(args)
        .arg("--home")
        .arg(home)
        .output()
        .expect("the mix binary runs")
}

/// A home nobody has started answers, and is still not there afterwards.
#[test]
fn a_home_that_does_not_exist_is_described_and_not_created() {
    let parent = tempfile::tempdir().expect("a temporary directory");
    let absent = parent.path().join("never-started");

    let output = mix(&absent, &["storage"]);

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let printed = String::from_utf8_lossy(&output.stdout);
    assert!(printed.contains("runtimes"), "{printed}");
    assert!(printed.contains("data"), "{printed}");
    assert!(
        printed.contains("nothing is installed yet"),
        "a home with nothing in it may still choose: {printed}"
    );

    assert!(
        !absent.exists(),
        "`mix storage` created the home it was asked about"
    );
}

/// **`--json` is the daemon's document, unchanged.** A client that re-serialised what it had only
/// parsed in order to print would be a second chance to render the same facts differently.
#[test]
fn json_is_what_the_daemon_printed() {
    let parent = tempfile::tempdir().expect("a temporary directory");
    let absent = parent.path().join("never-started");

    let through_mix = mix(&absent, &["--json", "storage"]);
    assert!(through_mix.status.success());

    let direct = Command::new(harness::daemon_binary())
        .arg("--storage")
        .arg("--home")
        .arg(&absent)
        .output()
        .expect("the daemon binary runs");
    assert!(direct.status.success());

    assert_eq!(
        String::from_utf8_lossy(&through_mix.stdout).trim(),
        String::from_utf8_lossy(&direct.stdout).trim()
    );

    // And it is one document, so a caller may parse it without finding the end of a stream first.
    let parsed: mixengine_proto::StorageReport =
        serde_json::from_slice(&through_mix.stdout).expect("one JSON document");
    assert!(parsed.changeable.is_free());
}

/// A `mix` that cannot find a daemon binary says so as a missing dependency, not as a crash.
#[test]
fn a_missing_daemon_binary_is_reported_as_one() {
    let parent = tempfile::tempdir().expect("a temporary directory");

    let output = Command::new(env!("CARGO_BIN_EXE_mix"))
        .env("MIXENGINE_DAEMON_BIN", parent.path().join("not-a-binary"))
        .args(["--json", "storage", "--home"])
        .arg(parent.path())
        .output()
        .expect("the mix binary runs");

    assert!(!output.status.success());

    let error: serde_json::Value = serde_json::from_slice(&output.stdout)
        .or_else(|_| serde_json::from_slice(&output.stderr))
        .expect("a wire error as JSON");

    assert_eq!(error["code"], "dependency_missing", "{error}");
    assert!(
        error["message"]
            .as_str()
            .is_some_and(|message| message.starts_with("cannot run ")),
        "a question asked of the daemon binary is not reported as a failed start: {error}"
    );
}

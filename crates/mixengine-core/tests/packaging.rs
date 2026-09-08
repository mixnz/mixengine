//! `packaging/common.sh`'s two arrays, against the names this crate actually looks for.
//!
//! **Roadmap task T85c is what this file exists to stop happening a second time.** `MIX_BINARIES`
//! named three binaries and [`mixengine_core::shims::source`] looked for a fourth beside the
//! running `mixengined`, so every release built from those scripts installed cleanly, started,
//! reported itself healthy, and could not run `php` — the `bin/` it fills was empty and
//! `Error::ShimMissing` was the only sign.
//!
//! The shape is [`mixengine_core::updates`]' own: `include_str!` the committed file, so one that is
//! deleted or moved is a build error rather than a test that reads nothing and passes.

use std::collections::BTreeSet;

/// What `packaging/stage.sh` sources, read at compile time.
const COMMON_SH: &str = include_str!("../../../packaging/common.sh");

/// The workspace manifest, for the membership check below.
const WORKSPACE: &str = include_str!("../../../Cargo.toml");

/// The entries of a one-line bash array declared in `packaging/common.sh`.
///
/// Panics rather than returning an empty set when the declaration is not there: an array that
/// stopped being declared is a packaging pipeline that stopped working, and a test that quietly
/// compared nothing to nothing would be the failure it is meant to catch.
fn declared(array: &str) -> BTreeSet<String> {
    let opening = format!("{array}=(");

    let line = COMMON_SH
        .lines()
        .find(|line| line.starts_with(&opening))
        .unwrap_or_else(|| panic!("packaging/common.sh declares {array} on one line"));

    line[opening.len()..]
        .trim_end_matches(')')
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

/// Every name a release has to contain is one the packaging scripts put in it.
///
/// Set equality and not "contains", because the failure being prevented is a list that drifted —
/// and a list somebody shortened drifts exactly as badly as one nobody lengthened.
#[test]
fn the_release_ships_every_binary_this_code_looks_for() {
    let expected: BTreeSet<String> = [
        // The CLI. The one of the four with no constant to borrow — nothing in `core` resolves it
        // by name — so it is spelled here and nowhere else.
        "mix".to_owned(),
        mixengine_core::updates::apply::SMOKE_EXECUTABLE.to_owned(),
        mixengine_core::shims::BINARY.to_owned(),
        mixengine_core::updates::apply::KEPT.to_owned(),
    ]
    .into_iter()
    .collect();

    assert_eq!(
        declared("MIX_BINARIES"),
        expected,
        "packaging/common.sh's MIX_BINARIES and the names this crate looks for have drifted \
         apart; the array is what every packaging script stages and checks, so a release cut \
         while they differ is one that installs and then cannot do what it was installed for"
    );
}

/// And every crate the stage builds is one that exists.
///
/// A typo here is otherwise a `cargo build -p` failure seven minutes into a packaging run, on five
/// runners at once.
#[test]
fn every_crate_the_stage_builds_is_a_workspace_member() {
    for name in declared("MIX_CRATES") {
        assert!(
            WORKSPACE.contains(&format!("\"crates/{name}\"")),
            "packaging/common.sh's MIX_CRATES names {name}, which is not a member of this \
             workspace"
        );
    }
}

/// The three files the desktop build reads its version out of, read at compile time.
///
/// None of them can inherit from `[workspace.package]`: the desktop application's crate is a
/// workspace of its own, excluded from this one (ADR 0027, and the design's D1). So the
/// inheritance is the test below — see the T104 design's D2. `include_str!` for the same reason as
/// the two constants above: a file that moved is a build error rather than a test that reads
/// nothing and passes.
const DESKTOP_PACKAGE_JSON: &str = include_str!("../../../apps/desktop/package.json");
/// The fourth: `npm ci` is what CI installs with, and it reads this file rather than the manifest
/// beside it.
const DESKTOP_PACKAGE_LOCK: &str = include_str!("../../../apps/desktop/package-lock.json");
const DESKTOP_TAURI_CONF: &str = include_str!("../../../apps/desktop/src-tauri/tauri.conf.json");
const DESKTOP_CARGO_TOML: &str = include_str!("../../../apps/desktop/src-tauri/Cargo.toml");

/// The `version` at the top level of a JSON document.
fn json_version(document: &str, what: &str) -> String {
    let parsed: serde_json::Value =
        serde_json::from_str(document).unwrap_or_else(|e| panic!("{what} is not JSON: {e}"));
    parsed
        .get("version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_else(|| panic!("{what} has no top-level string `version`"))
        .to_owned()
}

/// The `version` of a manifest's `[package]` or `[workspace.package]` table.
fn toml_version(manifest: &str, table: &[&str], what: &str) -> String {
    // `Table` rather than `Value`: `Value`'s own `FromStr` reads a TOML *value*, and a manifest is
    // a document — it stops at the first section header with "unexpected content".
    let parsed: toml::Table = manifest
        .parse()
        .unwrap_or_else(|e| panic!("{what} is not TOML: {e}"));
    let document = toml::Value::Table(parsed);

    let mut at = &document;
    for key in table {
        at = at
            .get(key)
            .unwrap_or_else(|| panic!("{what} has no [{}] table", table.join(".")));
    }

    at.get("version")
        .and_then(toml::Value::as_str)
        .unwrap_or_else(|| panic!("{what}'s [{}] has no string version", table.join(".")))
        .to_owned()
}

/// The window reports the version of the release it was cut with, and never one of its own.
///
/// **What this stops.** `apps/desktop` carried MixDB's own version through phase 11, and a bump of
/// the root manifest could not reach it — the crate is not a member of this workspace and cannot
/// inherit from it. A window built from a release tag while one of these three disagreed would
/// name the wrong version in Settings, offer the wrong one to the updater and put it in every
/// crash report, none of which is visible until somebody reads a support thread. Cutting a release
/// stays a bump of the root `Cargo.toml`; this is what makes that bump enough.
#[test]
fn the_desktop_application_carries_the_workspace_version() {
    let workspace = toml_version(WORKSPACE, &["workspace", "package"], "the root Cargo.toml");

    for (what, found) in [
        (
            "apps/desktop/package.json",
            json_version(DESKTOP_PACKAGE_JSON, "apps/desktop/package.json"),
        ),
        (
            "apps/desktop/package-lock.json",
            json_version(DESKTOP_PACKAGE_LOCK, "apps/desktop/package-lock.json"),
        ),
        (
            "apps/desktop/src-tauri/tauri.conf.json",
            json_version(DESKTOP_TAURI_CONF, "apps/desktop/src-tauri/tauri.conf.json"),
        ),
        (
            "apps/desktop/src-tauri/Cargo.toml",
            toml_version(
                DESKTOP_CARGO_TOML,
                &["package"],
                "apps/desktop/src-tauri/Cargo.toml",
            ),
        ),
    ] {
        assert_eq!(
            found, workspace,
            "{what} says {found} and the workspace says {workspace}; the desktop application's \
             version is the workspace's, and a release cut while the two differ is a window that \
             reports the wrong one"
        );
    }
}

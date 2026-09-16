//! The ini set's module names against **every PHP branch this product offers**.
//!
//! # Why this is not the suite that already exists
//!
//! `mixengine-cli/tests/php_extensions.rs` loads a real PHP and compares loaded sets, and it missed
//! the defect this suite exists for: it is pinned to 8.3.33, and PHP 7.2 added a fallback that makes
//! a *wrong* module name load anyway. Its module note says the bare spelling is "a spelling this PHP
//! accepts" — which was true of the PHP it measured and false of the two oldest branches on offer.
//! A claim about every branch measured on one branch that cannot falsify it is the shape of the bug,
//! not an accident of it.
//!
//! So this suite runs against **every** PHP it is given. `MIXENGINE_PHP_RUNTIMES` is the list the
//! `bench` job already fetches — 7.0.33, 7.4.33 and 8.3.33 — and 7.0.33 is the only fixture in this
//! repository that can tell a right module name from a wrong one.
//!
//! # What is asserted, and why it is not the text of the ini
//!
//! The text of the ini was exactly what was wrong, so a test reading it back would have agreed with
//! the defect. What is asserted is that the modules **load**: the set `php -m` reports with this
//! `conf.d` in front of it, minus the set it reports without one, has one entry for every module
//! file the artifact ships. The subtraction is what keeps this free of a name table — `opcache.so`
//! is reported as `Zend OPcache` and nothing in a filename says so.
//!
//! Stderr is asserted too, and separately. A `zend_extension` PHP cannot load is a startup warning
//! rather than a refusal to start, so a suite reading only the exit status would be green on a home
//! that prints two failures at every command — which is what somebody actually hit.
//!
//! **`#[ignore]`d rather than skipped**, for `php_extensions.rs`' reason: a test that quietly
//! returns when it finds no PHP is a green suite that proved nothing on the day the download broke.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use mixengine_core::index::Extensions;
use mixengine_core::runtimes::extensions::State;
use mixengine_proto::{PackageVersion, RuntimeKind};

/// Where one or more unpacked PHPs are, as the CI step and a developer both set it.
const RUNTIMES: &str = "MIXENGINE_PHP_RUNTIMES";

/// The single-PHP variable the other suites use, read as a list of one.
const RUNTIME: &str = "MIXENGINE_PHP_RUNTIME";

/// What `php -m` prints as headings rather than as modules.
fn modules_from(output: &str) -> BTreeSet<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('['))
        .map(str::to_lowercase)
        .collect()
}

/// Every PHP this machine was given.
///
/// # Panics
///
/// When neither variable is set, naming both and what fetches them.
fn runtimes() -> Vec<PathBuf> {
    let listed = std::env::var_os(RUNTIMES)
        .or_else(|| std::env::var_os(RUNTIME))
        .unwrap_or_else(|| {
            panic!(
                "neither {RUNTIMES} nor {RUNTIME} is set, so there is no PHP to judge these module \
                 names against. The `php` steps in .github/workflows/ci.yml fetch them; by hand, \
                 unpack any PHP from mixengine-packages' releases and point {RUNTIME} at the \
                 directory it unpacked to."
            )
        });

    std::env::split_paths(&listed)
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

/// The interpreter inside an unpacked artifact: `bin/php` on Unix, `php.exe` at its root on Windows.
fn interpreter(install: &Path) -> PathBuf {
    let windows = install.join("php.exe");
    if windows.is_file() {
        return windows;
    }

    install.join("bin").join("php")
}

/// The directory of loadable modules inside an install, relative to it, and what it holds.
///
/// **Found by looking rather than read from an index**, because the index is not what this suite is
/// judging: an artifact's module files are the ground truth a generated name either matches or does
/// not. The suffix is the one PHP builds with on this system — `so` everywhere but Windows, and on
/// macOS too, where a PHP extension is never a `.dylib`.
fn modules(install: &Path) -> (String, Vec<String>) {
    let suffix = if cfg!(windows) { "dll" } else { "so" };

    let mut found: Option<(PathBuf, Vec<String>)> = None;
    let mut walking = vec![install.to_path_buf()];

    while let Some(directory) = walking.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };

        let mut here = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walking.push(path);
            } else if path
                .extension()
                .is_some_and(|extension| extension == suffix)
            {
                let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                // Windows ships them as `php_<name>.dll`; the name is the half PHP knows.
                here.push(stem.strip_prefix("php_").unwrap_or(&stem).to_owned());
            }
        }

        if !here.is_empty() {
            here.sort();
            assert!(
                found.is_none(),
                "two directories of modules under {} — this suite would have to be told which",
                install.display()
            );
            found = Some((directory, here));
        }
    }

    let (directory, names) = found.unwrap_or_else(|| {
        panic!(
            "no *.{suffix} anywhere under {} — an artifact with no loadable module cannot say \
             whether a module name is right",
            install.display()
        )
    });

    let relative = directory
        .strip_prefix(install)
        .unwrap_or(&directory)
        .to_string_lossy()
        .replace('\\', "/");

    (relative, names)
}

/// What this build calls itself, so a failure names the branch rather than a directory.
fn version_of(php: &Path) -> String {
    let ran = std::process::Command::new(php)
        .args(["-n", "-r", "echo PHP_VERSION;"])
        .output()
        .unwrap_or_else(|error| panic!("{} did not run: {error}", php.display()));

    String::from_utf8_lossy(&ran.stdout).trim().to_owned()
}

/// `php -m`, with this `conf.d` in front of it or with none.
///
/// **Not `-n`**, which would be the obvious way to ignore a machine's own `php.ini` and is the one
/// flag that cannot be used here: it suppresses the scanned directory as well, so the set would be
/// the same both times and the subtraction would always be empty. `-c` at a directory holding no
/// `php.ini` does the same job and leaves `PHP_INI_SCAN_DIR` alone.
fn loaded(php: &Path, empty: &Path, scan: Option<&Path>) -> (BTreeSet<String>, String) {
    let mut command = std::process::Command::new(php);
    command.arg("-c").arg(empty).arg("-m");

    match scan {
        Some(directory) => command.env("PHP_INI_SCAN_DIR", directory),
        // An inherited one would be this machine's, and would put modules in the baseline that the
        // measurement is supposed to be adding.
        None => command.env("PHP_INI_SCAN_DIR", empty),
    };

    let ran = command
        .output()
        .unwrap_or_else(|error| panic!("{} did not run: {error}", php.display()));

    (
        modules_from(&String::from_utf8_lossy(&ran.stdout)),
        String::from_utf8_lossy(&ran.stderr).into_owned(),
    )
}

/// Every module an artifact ships is loaded by the ini set MixEngine generates for it.
///
/// The defect this pins: a bare `extension = igbinary` names a file no PHP build ships, and only
/// 7.2 and later recover from it by appending the suffix themselves.
#[test]
#[ignore = "needs a real PHP — see the module note, and the `php` steps in ci.yml"]
fn every_shipped_module_loads_on_every_branch() {
    let empty = tempfile::TempDir::new().expect("a directory with no php.ini in it");

    for install in runtimes() {
        let php = interpreter(&install);
        assert!(php.is_file(), "no interpreter at {}", php.display());

        let version = version_of(&php);
        let (directory, names) = modules(&install);

        let state = State {
            kind: RuntimeKind::Php,
            version: PackageVersion::parse(&version)
                .unwrap_or_else(|error| panic!("{php:?} reported {version:?}: {error}")),
            install_path: install.clone(),
            directory: Some(directory),
            offered: Extensions {
                compiled_in: Vec::new(),
                shared: names.clone(),
                enabled: names.clone(),
            },
            choices: BTreeMap::new(),
            additions: Vec::new(),
            ca_bundle: None,
        };

        let conf_d = tempfile::TempDir::new().expect("a directory for the generated set");
        for document in state.documents() {
            std::fs::write(conf_d.path().join(document.relative()), document.contents())
                .expect("the generated set is written");
        }

        let (baseline, _) = loaded(&php, empty.path(), None);
        let (with_set, complaints) = loaded(&php, empty.path(), Some(conf_d.path()));

        assert!(
            !complaints.contains("Failed loading") && !complaints.contains("Unable to load"),
            "PHP {version} could not load what MixEngine named:\n{complaints}"
        );

        let gained: Vec<&String> = with_set.difference(&baseline).collect();
        assert_eq!(
            gained.len(),
            names.len(),
            "PHP {version} ships {names:?} and gained {gained:?} from the generated set"
        );
    }
}

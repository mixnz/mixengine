//! Who is running from a directory — roadmap task **T182**, D4.
//!
//! **Before an uninstall removes a directory, the processes whose executable lies inside it are the
//! ones that would stop it half-way**: a `php artisan serve` started through a shim, a database a
//! person started by hand from `runtimes/`. Asked of `sysinfo`, like the metrics sampler, which has
//! already done the per-system work.
//!
//! What a process table cannot show — a working directory, an open file — is caught by the rename
//! in [`crate::tombstone`] instead.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// One process in the way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occupant {
    /// Its pid, for a person to find it by.
    pub pid: u32,

    /// Its name, as the process table spells it.
    pub name: String,

    /// The executable, which is what put it on this list.
    pub executable: PathBuf,
}

/// Every process whose executable lies inside one of `directories`, except `spare` and anything
/// descended from it, in pid order.
///
/// **`spare` is the daemon asking**: it and everything it started are stopped by its own shutdown,
/// in dependency order, before anything is removed — so they are not in anybody's way.
#[must_use]
pub fn processes_under(directories: &[PathBuf], spare: Option<u32>) -> Vec<Occupant> {
    if directories.is_empty() {
        return Vec::new();
    }

    let roots: Vec<PathBuf> = directories.iter().map(|path| comparable(path)).collect();

    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::OnlyIfNotSet),
    );

    let parents: BTreeMap<u32, u32> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| Some((pid.as_u32(), process.parent()?.as_u32())))
        .collect();

    let mut found: Vec<Occupant> = system
        .processes()
        .iter()
        .filter(|(_, process)| process.thread_kind().is_none())
        .filter_map(|(pid, process)| {
            let pid = pid.as_u32();
            let executable = process.exe()?;
            let at = comparable(executable);

            if !roots.iter().any(|root| at.starts_with(root)) {
                return None;
            }

            if spare.is_some_and(|spare| descends_from(pid, spare, &parents)) {
                return None;
            }

            Some(Occupant {
                pid,
                name: process.name().to_string_lossy().into_owned(),
                executable: executable.to_path_buf(),
            })
        })
        .collect();

    found.sort_by_key(|occupant| occupant.pid);
    found
}

/// Is `pid` `ancestor`, or started by it at any depth?
///
/// **Bounded**, because a parent table is a snapshot of a moving system, and a pid the system handed
/// round can make it a loop.
fn descends_from(pid: u32, ancestor: u32, parents: &BTreeMap<u32, u32>) -> bool {
    let mut current = pid;

    for _ in 0..=parents.len() {
        if current == ancestor {
            return true;
        }

        match parents.get(&current) {
            Some(&parent) if parent != current => current = parent,
            _ => return false,
        }
    }

    false
}

/// A path two spellings of which compare equal: canonical where it exists, and on Windows — where
/// the file system ignores case — folded to lower case.
fn comparable(path: &Path) -> PathBuf {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    if cfg!(windows) {
        PathBuf::from(canonical.to_string_lossy().to_lowercase())
    } else {
        canonical
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A long-running program copied into a directory of its own, so the test controls where its
    /// executable lies. `ping` and `sleep` are on every machine this runs on.
    fn start_a_copy(directory: &Path) -> std::process::Child {
        let (source, args): (PathBuf, &[&str]) = if cfg!(windows) {
            (
                PathBuf::from(std::env::var("SystemRoot").expect("SystemRoot"))
                    .join(r"System32\PING.EXE"),
                &["-n", "30", "127.0.0.1"],
            )
        } else {
            (PathBuf::from("/bin/sleep"), &["30"])
        };

        let copy = directory.join(source.file_name().expect("a file name"));
        std::fs::copy(&source, &copy).expect("copy the program");

        std::process::Command::new(&copy)
            .args(args)
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("start the copy")
    }

    #[test]
    fn a_program_running_from_the_directory_is_found() {
        let inside = tempfile::tempdir().expect("tempdir");
        let mut child = start_a_copy(inside.path());

        let found = processes_under(&[inside.path().to_path_buf()], None);

        let _ = child.kill();
        let _ = child.wait();
        assert!(
            found.iter().any(|occupant| occupant.pid == child.id()),
            "{found:?}"
        );
    }

    #[test]
    fn a_program_running_from_elsewhere_is_not() {
        let inside = tempfile::tempdir().expect("tempdir");
        let elsewhere = tempfile::tempdir().expect("tempdir");
        let mut child = start_a_copy(elsewhere.path());

        let found = processes_under(&[inside.path().to_path_buf()], None);

        let _ = child.kill();
        let _ = child.wait();
        assert!(found.is_empty(), "{found:?}");
    }

    /// The daemon spares itself and everything it started: its own shutdown stops those.
    #[test]
    fn a_descendant_of_the_spared_pid_is_not() {
        let inside = tempfile::tempdir().expect("tempdir");
        let mut child = start_a_copy(inside.path());

        let found = processes_under(&[inside.path().to_path_buf()], Some(std::process::id()));

        let _ = child.kill();
        let _ = child.wait();
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    fn the_ancestry_walk_stops_on_a_loop() {
        let parents = BTreeMap::from([(1, 2), (2, 1)]);

        assert!(!descends_from(1, 99, &parents));
        assert!(descends_from(1, 2, &parents));
    }
}

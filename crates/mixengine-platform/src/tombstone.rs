//! A directory is renamed before it is deleted — roadmap task **T182**, D6.
//!
//! **Deleting a directory tree is not one operation**: a `remove_dir_all` that meets a held file half
//! way leaves half a database behind. A rename is one operation, and Windows refuses it while
//! anything inside the directory is held open or is a process's working directory — so every
//! directory is renamed to a *tombstone* first, all of them or none, and only then deleted.
//!
//! A tombstone is ours by its name, `<name>.removing-<pid>`, so one that could not be deleted is
//! found and removed by the next uninstall. **Not the restart queue**: `MoveFileEx` with
//! `MOVEFILE_DELAY_UNTIL_REBOOT` writes under `HKLM` and needs an administrator the daemon is not.
//!
//! Only `std::fs`, and so not behind a feature: `mix` reads [`tombstones_beside`] too, to tell a
//! finished uninstall from one that left something behind.

use std::path::{Path, PathBuf};

/// What sits between a directory's own name and the pid in its tombstone's.
pub const MARK: &str = ".removing-";

/// A tombstone that is still there after the delete.
#[derive(Debug)]
pub struct Leftover {
    /// The tombstone.
    pub path: PathBuf,

    /// Why it stayed.
    pub error: std::io::Error,
}

/// The directory whose rename was refused. Every directory is back where it was.
#[derive(Debug)]
pub struct Refused {
    /// The directory that could not be renamed.
    pub path: PathBuf,

    /// What the system said.
    pub error: std::io::Error,

    /// A file inside it that another program holds open, when one could be found — T182b. The
    /// system names only the directory, and the file is what tells a person which program to close.
    pub held: Option<PathBuf>,
}

/// Rename every directory in `paths` to its tombstone, then delete the tombstones.
///
/// A path that is not there is skipped, and one that already is a tombstone is deleted as it is.
///
/// # Errors
///
/// [`Refused`] when any rename fails. Every directory renamed before it is renamed back first, so
/// nothing has been deleted.
pub fn remove_all_or_nothing(paths: &[PathBuf], pid: u32) -> Result<Vec<Leftover>, Refused> {
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();

    for path in paths {
        if std::fs::symlink_metadata(path).is_err() {
            continue;
        }

        if is_tombstone(path) {
            moved.push((path.clone(), path.clone()));
            continue;
        }

        let tombstone = tombstone_for(path, pid);

        if let Err(error) = std::fs::rename(path, &tombstone) {
            for (original, renamed) in moved.iter().rev() {
                if original != renamed {
                    let _ = std::fs::rename(renamed, original);
                }
            }

            return Err(Refused {
                held: first_held(path),
                path: path.clone(),
                error,
            });
        }

        moved.push((path.clone(), tombstone));
    }

    let mut left = Vec::new();

    for (_, renamed) in &moved {
        match std::fs::remove_dir_all(renamed) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => left.push(Leftover {
                path: renamed.clone(),
                error,
            }),
        }
    }

    Ok(left)
}

/// Every tombstone an earlier run left beside `path`, in name order.
#[must_use]
pub fn tombstones_beside(path: &Path) -> Vec<PathBuf> {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Vec::new();
    };

    let prefix = format!("{}{MARK}", name.to_string_lossy());

    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };

    let mut found: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .map(|entry| entry.path())
        .collect();

    found.sort();
    found
}

/// Where the daemon `pid` leaves the reason its removal did not finish, for `mix` to read once that
/// process is gone — roadmap task **T182b**.
///
/// **Outside the home**, because the home is what could not be removed, and **not the daemon's
/// standard error**, which a daemon started in the background writes to nowhere. Found by the pid,
/// which `mix` already holds to wait for the process.
#[must_use]
pub fn note_for(pid: u32) -> PathBuf {
    std::env::temp_dir().join(format!("mixengined-{pid}.uninstall"))
}

/// The first file under `directory` that another program holds open, looked for after a refusal.
///
/// **Windows only**, because it is the one system whose rename a held file refuses. Opening a file
/// with no sharing at all fails exactly when somebody else has it open. The walk is bounded, since
/// it runs once, on a failure, over a home that can hold a great many files.
#[cfg(windows)]
fn first_held(directory: &Path) -> Option<PathBuf> {
    use std::os::windows::fs::OpenOptionsExt as _;

    /// `ERROR_SHARING_VIOLATION`: somebody else has it open.
    const SHARING_VIOLATION: i32 = 32;
    const LOOKED_AT_MOST: usize = 50_000;

    let mut waiting = vec![directory.to_path_buf()];
    let mut looked = 0;

    while let Some(current) = waiting.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.filter_map(Result::ok) {
            looked += 1;
            if looked > LOOKED_AT_MOST {
                return None;
            }

            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };

            if kind.is_dir() {
                waiting.push(path);
                continue;
            }

            let opened = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&path);

            if let Err(error) = opened
                && error.raw_os_error() == Some(SHARING_VIOLATION)
            {
                return Some(path);
            }
        }
    }

    None
}

/// Nothing to look for: an open file does not refuse a rename here.
#[cfg(not(windows))]
fn first_held(_directory: &Path) -> Option<PathBuf> {
    None
}

/// Where `path` is set aside while it is being deleted.
fn tombstone_for(path: &Path, pid: u32) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();

    path.with_file_name(format!("{name}{MARK}{pid}"))
}

/// Is `path` already somebody's tombstone?
fn is_tombstone(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().contains(MARK))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory_with_a_file(parent: &Path, name: &str) -> PathBuf {
        let directory = parent.join(name);
        std::fs::create_dir_all(&directory).expect("create");
        std::fs::write(directory.join("file"), b"x").expect("write");
        directory
    }

    #[test]
    fn every_directory_goes_when_nothing_is_in_the_way() {
        let root = tempfile::tempdir().expect("tempdir");
        let a = directory_with_a_file(root.path(), "a");
        let b = directory_with_a_file(root.path(), "b");

        let left = remove_all_or_nothing(&[a.clone(), b.clone()], 7).expect("nothing refused");

        assert!(left.is_empty(), "{left:?}");
        assert!(!a.exists() && !b.exists());
        assert!(tombstones_beside(&a).is_empty());
    }

    /// The second directory cannot be renamed — its tombstone's name is taken by a non-empty
    /// directory, which refuses a rename on every system — so the first is put back and nothing is
    /// deleted.
    #[test]
    fn one_refusal_puts_every_directory_back() {
        let root = tempfile::tempdir().expect("tempdir");
        let a = directory_with_a_file(root.path(), "a");
        let b = directory_with_a_file(root.path(), "b");
        directory_with_a_file(root.path(), "b.removing-7");

        let refused = remove_all_or_nothing(&[a.clone(), b.clone()], 7).expect_err("refused");

        assert_eq!(refused.path, b);
        assert!(a.join("file").exists(), "a was not put back");
        assert!(b.join("file").exists(), "b was touched");
        assert!(!root.path().join("a.removing-7").exists());
    }

    #[test]
    fn a_missing_directory_is_not_a_refusal() {
        let root = tempfile::tempdir().expect("tempdir");

        let left = remove_all_or_nothing(&[root.path().join("gone")], 7).expect("fine");

        assert!(left.is_empty());
    }

    /// A tombstone from an earlier run is deleted as it is, not renamed again.
    #[test]
    fn an_old_tombstone_is_found_and_removed() {
        let root = tempfile::tempdir().expect("tempdir");
        let home = root.path().join("MixEngine");
        let old = directory_with_a_file(root.path(), "MixEngine.removing-3");

        assert_eq!(tombstones_beside(&home), vec![old.clone()]);

        let left = remove_all_or_nothing(std::slice::from_ref(&old), 7).expect("fine");

        assert!(left.is_empty());
        assert!(!old.exists());
    }

    /// Windows: a file held open without share-delete stops the rename, which is the whole point.
    #[cfg(windows)]
    #[test]
    fn a_held_file_puts_every_directory_back() {
        use std::os::windows::fs::OpenOptionsExt as _;

        let root = tempfile::tempdir().expect("tempdir");
        let a = directory_with_a_file(root.path(), "a");
        let b = directory_with_a_file(root.path(), "b");

        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(b.join("file"))
            .expect("hold");

        let refused = remove_all_or_nothing(&[a.clone(), b.clone()], 7).expect_err("refused");
        drop(held);

        assert_eq!(refused.path, b);
        assert!(a.join("file").exists() && b.join("file").exists());
    }

    /// Windows: the same, for a file held the way `std` opens one — with share-delete — which is how
    /// most programs on this system hold a log open.
    #[cfg(windows)]
    #[test]
    fn a_file_held_with_share_delete_still_stops_the_rename() {
        let root = tempfile::tempdir().expect("tempdir");
        let a = directory_with_a_file(root.path(), "a");

        let held = std::fs::File::open(a.join("file")).expect("hold");
        let outcome = remove_all_or_nothing(std::slice::from_ref(&a), 7);
        drop(held);

        assert!(outcome.is_err(), "{outcome:?}");
        assert!(a.join("file").exists());
    }

    /// T182b. The file another program holds is found and named, not only the directory above it.
    #[cfg(windows)]
    #[test]
    fn the_held_file_is_found_under_the_directory() {
        let root = tempfile::tempdir().expect("a temporary directory");
        let inner = root.path().join("logs").join("services");
        std::fs::create_dir_all(&inner).expect("a nested directory");
        std::fs::write(root.path().join("free.txt"), b"nobody has this").expect("a free file");
        let held = inner.join("current.log");
        std::fs::write(&held, b"somebody has this").expect("a held file");

        let _open = std::fs::File::open(&held).expect("held open");

        assert_eq!(first_held(root.path()), Some(held));
    }

    #[test]
    fn nothing_is_held_in_a_directory_nobody_has_open() {
        let root = tempfile::tempdir().expect("a temporary directory");
        std::fs::write(root.path().join("free.txt"), b"nobody has this").expect("a free file");

        assert_eq!(first_held(root.path()), None);
    }
}

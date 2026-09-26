//! The lock both updaters take before they touch a file — spec D7.
//!
//! A contract between two programs that share no code: `<install directory>/update.lock`, held
//! with `flock(LOCK_EX | LOCK_NB)` on Unix and with share mode `FILE_SHARE_READ` alone on Windows,
//! containing the holder's pid and a newline. `mix self-update` takes the same file through
//! `mixengine-platform`'s lock, and the test below holds the two together.

use std::fs::{File, OpenOptions};
use std::io::{self, Seek as _, SeekFrom, Write as _};
use std::path::Path;

/// The file, in the directory being swapped.
pub const LOCK_FILE: &str = "update.lock";

/// The open file whose lock is held. Closing it, or ending the process, releases it.
#[derive(Debug)]
pub struct UpdateLock {
    _file: File,
}

#[derive(Debug)]
pub enum Acquired {
    Held(UpdateLock),
    /// Somebody holds it; their pid when the file says.
    Taken(Option<u32>),
    /// The directory is not this account's to write, so nothing can be swapped here either.
    Unwritable,
}

pub fn acquire(directory: &Path) -> io::Result<Acquired> {
    let path = directory.join(LOCK_FILE);
    let mut file = match open(&path) {
        Ok(Some(file)) => file,
        Ok(None) => return Ok(Acquired::Taken(recorded_pid(&path))),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            return Ok(Acquired::Unwritable)
        }
        Err(error) => return Err(error),
    };
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(format!("{}\n", std::process::id()).as_bytes())?;
    file.flush()?;
    Ok(Acquired::Held(UpdateLock { _file: file }))
}

fn recorded_pid(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// The open file holding the lock, or `None` when somebody else holds it.
#[cfg(unix)]
fn open(path: &Path) -> io::Result<Option<File>> {
    use std::os::fd::AsRawFd as _;

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    // SAFETY: `flock` takes a descriptor this function owns and two flags; it touches no memory.
    let locked = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if locked == 0 {
        return Ok(Some(file));
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EWOULDBLOCK) {
        Ok(None)
    } else {
        Err(error)
    }
}

/// The open file holding the lock, or `None` when somebody else holds it.
#[cfg(windows)]
fn open(path: &Path) -> io::Result<Option<File>> {
    use std::os::windows::fs::OpenOptionsExt as _;

    /// `FILE_SHARE_READ`: readers welcome, a second writer refused.
    const FILE_SHARE_READ: u32 = 0x1;
    /// `ERROR_SHARING_VIOLATION`: what that second writer is told.
    const ERROR_SHARING_VIOLATION: i32 = 32;

    match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(FILE_SHARE_READ)
        .open(path)
    {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_taker_is_told_the_first_ones_pid() {
        let directory = tempfile::tempdir().unwrap();
        let first = acquire(directory.path()).unwrap();
        assert!(matches!(first, Acquired::Held(_)));
        match acquire(directory.path()).unwrap() {
            Acquired::Taken(pid) => assert_eq!(pid, Some(std::process::id())),
            other => panic!("expected Taken, got {other:?}"),
        }
        drop(first);
        assert!(matches!(
            acquire(directory.path()).unwrap(),
            Acquired::Held(_)
        ));
    }

    /// The contract with `mix self-update` (spec D7): the two programs share no code, only this
    /// file, and each must keep the other out.
    #[test]
    fn mixengines_lock_and_this_one_keep_each_other_out() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(LOCK_FILE);

        let theirs = mixengine_platform::lock::Lock::acquire(&path).unwrap();
        assert!(matches!(
            theirs,
            mixengine_platform::lock::Acquired::Held(_)
        ));
        assert!(matches!(
            acquire(directory.path()).unwrap(),
            Acquired::Taken(Some(_))
        ));
        drop(theirs);

        let ours = acquire(directory.path()).unwrap();
        assert!(matches!(ours, Acquired::Held(_)));
        match mixengine_platform::lock::Lock::acquire(&path).unwrap() {
            mixengine_platform::lock::Acquired::Taken(holder) => {
                assert_eq!(holder.pid(), Some(std::process::id()))
            }
            mixengine_platform::lock::Acquired::Held(_) => panic!("both held the lock"),
        }
    }
}

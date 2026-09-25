//! Unix's half of [`crate::handover`]: `exec`, and `OsStr` as bytes.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::os::unix::process::CommandExt as _;
use std::path::Path;
use std::process::Command;

use crate::{Error, Result};

/// Replace this process with `command`, keeping everything the caller was given.
///
/// `exec` and nothing else, which is the whole of the Unix side: the pid, the open descriptors, the
/// controlling terminal, the process group and every signal disposition survive, because there is
/// no new process for them to have to be copied to. A `SIGINT` from the terminal reaches the
/// program for the same reason — it is in the foreground process group already, having never left
/// it.
///
/// **Deliberately not `new_session`**, unlike both other spawns in this module. A shim that put the
/// program in a session of its own would take it out of the terminal's foreground group, so Ctrl-C
/// would reach nothing and a program reading from the terminal would be stopped with `SIGTTIN`.
///
/// The return type is Windows's: on this system the only way out of here is the error, and
/// `CommandExt::exec` is typed to say so.
pub(crate) fn hand_over(mut command: Command, program: &Path) -> Result<i32> {
    let source = command.exec();

    Err(Error::Io {
        action: "run",
        path: program.to_path_buf(),
        source,
    })
}

/// An `OsStr` as the record carries it: its bytes, which is all a Unix string is.
pub(crate) fn os_bytes(value: &OsStr) -> Vec<u8> {
    value.as_bytes().to_vec()
}

/// What [`os_bytes`] wrote. Never fails here; the `Result` is Windows', whose UTF-16 can be odd.
#[expect(
    clippy::unnecessary_wraps,
    reason = "Windows' counterpart can fail, and `handover.rs` calls both through one signature"
)]
pub(crate) fn os_string(bytes: &[u8]) -> Result<OsString> {
    Ok(OsString::from_vec(bytes.to_vec()))
}

/// A byte that is never valid UTF-8.
#[cfg(test)]
pub(crate) fn not_unicode_for_tests() -> OsString {
    OsString::from_vec(vec![b'p', 0xFF, b'h'])
}

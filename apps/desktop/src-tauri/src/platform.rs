//! The three things every corner of the app needed and each wrote out for itself.
//!
//! None of them is about a database, a terminal or a request — they are about the machine MixDB is
//! running on and the runtime it is running in, which is why they are here at the crate root rather
//! than in whichever module happened to want them first.

use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Runs blocking work off the async runtime, turning a panicked or cancelled task into an error.
///
/// Everything that reaches the OS credential store or a `std::process::Command` goes through here:
/// both block, and blocking a Tauri command's thread blocks the webview's answer to every other
/// command with it.
pub async fn in_background<T, F>(work: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| err!("error.backgroundTaskFailed", message = e))?
}

/// Where MixDB keeps what it remembers between runs: the tools it downloaded, and the SSH host
/// keys it has seen.
pub fn app_data_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| err!("error.noAppDataDir", message = e))
}

/// Keeps a child process from opening a console window of its own.
///
/// A release build has no console — `windows_subsystem = "windows"` — so Windows gives every child
/// in the console subsystem a new one, which is a real black window. A tool that runs for a few
/// tens of milliseconds shows up as a strange window flashing over the app, and looks exactly like
/// something running behind the user's back.
///
/// Does nothing anywhere else, so callers need no `cfg` of their own.
pub fn hide_console(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// Not in `std`, and `windows-sys` is not a dependency for one integer.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

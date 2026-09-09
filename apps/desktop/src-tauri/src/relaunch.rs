//! Starting this window again — roadmap task **T106**.
//!
//! `tauri-plugin-process` did this until MixEngine's updater became the only updater. It left with
//! `tauri-plugin-updater`, whose feed, key and endpoint belonged to a repository that is about to be
//! archived; what stayed is the two things it was used for — the ErrorBoundary's *Restart app*, and
//! coming back on the new version after `update.apply` has replaced this executable underneath the
//! running process.
//!
//! # Three things here are not obvious
//!
//! **The path is read once, at startup.** On Linux `std::env::current_exe` reads `/proc/self/exe`,
//! which follows the *inode* and not the name: after the swap has renamed `mixlab` to `mixlab.old`
//! and written a new `mixlab`, a running window asking afterwards is told its own path is
//! `…/mixlab.old`. Relaunching that is relaunching the version the user just replaced, with nothing
//! anywhere to say so. So [`remember`] runs on the first line of `run()`, before an update can have
//! happened, and [`origin`] is what everything else reads.
//!
//! **A relaunched copy must not hand its start back to the copy it is replacing.** `run()`'s second
//! act is `launch::forward`, which finds the still-running predecessor and exits — so a naive
//! spawn-then-exit produces no window at all. The parent sets [`ENV`] on the child; the child sees
//! it, skips `forward`, and waits for the predecessor's endpoint to go quiet instead.
//!
//! **[`ENV`] is read and removed on the first line.** Left in the environment it is inherited by
//! every terminal tab, every dump tool, and by the *next* relaunch's child — which would then skip
//! `forward` for ever. Taken the way `launch::Opening` takes the handoff credential, and for the
//! same reason.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Runtime};

use crate::error::AppError;
use crate::instance;

/// What the parent sets on the copy it is starting in its place.
///
/// Its value is never read: what matters is that it is there, and that the child removes it.
const ENV: &str = "MIXLAB_RELAUNCH";

/// The name this window answers to in a payload's `provides`.
///
/// `cargo` names the executable after `[package].name`, `packaging/common.sh`'s `MIX_WINDOW` is held
/// to that same string by `crates/mixengine-core/tests/packaging.rs`, and
/// `mixengine_core::updates::apply::WINDOW` is held to `MIX_WINDOW`. So this is the same string the
/// daemon reports in `UpdateApplied::replaced`, and it cannot drift from it.
const NAME: &str = env!("CARGO_PKG_NAME");

/// How long a relaunched copy waits for its predecessor to let go of the endpoint.
///
/// A predecessor still there after this is a process that is stuck, and opening anyway is the right
/// answer: `instance::serve` finds the endpoint taken, says so on stderr, and this copy runs without
/// the single-instance listener — the state a race between two ordinary starts already produces, and
/// a window on the new version rather than no window at all.
const HANDOVER_TIMEOUT: Duration = Duration::from_secs(15);

/// How often it asks. Short enough that the handover is not felt, long enough not to spin.
const HANDOVER_POLL: Duration = Duration::from_millis(100);

/// Where this window was started from.
#[derive(Debug, Clone)]
pub struct Origin {
    /// The file to start again. Inside the bundle, on macOS.
    pub executable: PathBuf,

    /// The thing an installer placed: the bundle on macOS, the executable everywhere else.
    ///
    /// This is what an update replaces, and what `UpdateApplied::directory` is the parent of.
    pub root: PathBuf,
}

static ORIGIN: OnceLock<Option<Origin>> = OnceLock::new();

/// Read this process's own executable, once, before anything can have replaced it.
///
/// Called from the first line of `run()`. Answers `false` on a machine whose operating system will
/// not name this process's executable at all — nothing here can restart anything there, and saying
/// so is better than guessing around it.
pub fn remember() -> bool {
    ORIGIN
        .get_or_init(|| {
            let executable = std::env::current_exe().ok()?;
            let root = mixengine_platform::install::application_root(&executable);
            Some(Origin { executable, root })
        })
        .is_some()
}

/// Where this window was started from, or `None` on a machine that would not say.
pub fn origin() -> Option<&'static Origin> {
    ORIGIN.get().and_then(Option::as_ref)
}

/// Whether this process is the copy another one started in its place — and forget it either way.
///
/// Read *and removed* on the first line of `run()`: see this module's third paragraph.
pub fn taking_over() -> bool {
    let present = std::env::var_os(ENV).is_some();
    std::env::remove_var(ENV);
    present
}

/// Block until the copy this one is replacing has let go of the endpoint, or until it is clear it
/// will not.
///
/// Runs on Tauri's own runtime, before the builder, exactly as `launch::forward` does.
pub fn wait_for_predecessor(identifier: &str) {
    let endpoint = instance::Endpoint::for_app(identifier);
    let deadline = Instant::now() + HANDOVER_TIMEOUT;

    tauri::async_runtime::block_on(async move {
        while Instant::now() < deadline {
            if !instance::listening(&endpoint).await {
                return;
            }
            tokio::time::sleep(HANDOVER_POLL).await;
        }
        eprintln!("mixlab: the copy being replaced is still holding the endpoint; opening anyway");
    });
}

/// Start this window again and end this process.
///
/// **The spawn comes first and the exit second**, always: a spawn that failed with the exit already
/// requested is a user left with no window and a message they never saw.
pub fn restart<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    let origin = origin().ok_or_else(|| err!("error.relaunchNoExecutable"))?;

    let mut command = std::process::Command::new(&origin.executable);
    command.env(ENV, "1");
    crate::platform::hide_console(&mut command);
    command
        .spawn()
        .map_err(|e| err!("error.relaunchFailed", message = e))?;

    app.exit(0);
    Ok(())
}

/// The ErrorBoundary's *Restart app*, and anything else that wants this window started again.
#[tauri::command]
pub fn relaunch_app(app: AppHandle) -> Result<(), AppError> {
    restart(&app)
}

/// What an applied update means for the window that asked for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Relaunch {
    /// This window was replaced and is starting again.
    Relaunching,

    /// The update did not replace a window here.
    ///
    /// **A sentence and not a silence.** It is the state a macOS `.pkg` install is always in: the
    /// four binaries are in `/usr/local/bin` and `MixLab.app` is in `/Applications`, so the swap
    /// finds no window beside `mixengined` and keeps it — correctly, by the rule that stops an update
    /// *adding* a window to a headless server. The daemon is then new and the window is old, and the
    /// only thing worse than that is it happening without saying so.
    NotReplaced,

    /// A window was replaced, and it was not this one — a portable archive beside an installed copy,
    /// both pointed at the same home. This one is untouched, and restarting it would prove nothing.
    Elsewhere,
}

/// Whether the window at `root` is the one an update replaced in `directory`.
///
/// Pure, so the three answers can be tested without an update, an install or a process.
///
/// **Canonicalized on both sides where it can be**, because the daemon's `directory` is the parent of
/// whatever path `mixengined` resolved its own executable to and this window's is whatever it was
/// started with: a symlink on one side and not the other would answer [`Relaunch::Elsewhere`] for the
/// install that was just replaced. A path that will not canonicalize — one that does not exist, which
/// on this code path it does — is compared as written.
fn decide(directory: &Path, replaced: &[String], root: &Path) -> Relaunch {
    if !replaced.iter().any(|name| name == NAME) {
        return Relaunch::NotReplaced;
    }

    let Some(file_name) = root.file_name() else {
        return Relaunch::Elsewhere;
    };

    let real = |path: PathBuf| std::fs::canonicalize(&path).unwrap_or(path);

    if real(directory.join(file_name)) == real(root.to_path_buf()) {
        Relaunch::Relaunching
    } else {
        Relaunch::Elsewhere
    }
}

/// `update.apply` has answered; decide what that means for this window, and act on it.
///
/// **Two fields and not `UpdateApplied` itself.** The typed answer is already in the front end, out
/// of `bindings/`; taking the whole struct here would mean a dependency on `mixengine-proto` for a
/// shape this function reads two fields of, and ADR 0027's rule 4 is a list to add to on purpose.
#[tauri::command]
pub fn relaunch_after_update(
    app: AppHandle,
    directory: String,
    replaced: Vec<String>,
) -> Result<Relaunch, AppError> {
    let Some(origin) = origin() else {
        return Ok(Relaunch::NotReplaced);
    };

    let outcome = decide(Path::new(&directory), &replaced, &origin.root);

    if outcome == Relaunch::Relaunching {
        restart(&app)?;
    }

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A payload that did not carry this window, or an install that did not have one where the
    /// binaries are — a macOS `.pkg`, whose window is in `/Applications` and whose binaries are in
    /// `/usr/local/bin`, and every headless install. Nothing to restart, and something to say.
    #[test]
    fn a_window_that_was_not_replaced_is_not_restarted() {
        assert_eq!(
            decide(
                Path::new("/usr/local/bin"),
                &["mix".to_owned(), "mixengined".to_owned()],
                Path::new("/Applications/MixLab.app"),
            ),
            Relaunch::NotReplaced
        );
    }

    /// Two installs on one machine pointed at one home. The window that was replaced is not this one.
    #[test]
    fn a_window_replaced_somewhere_else_is_not_this_one() {
        assert_eq!(
            decide(
                Path::new("/opt/mixengine"),
                &[NAME.to_owned()],
                Path::new("/home/me/mixengine/mixlab"),
            ),
            Relaunch::Elsewhere
        );
    }

    /// The ordinary case: the window is beside the binaries, the swap replaced it, and this process
    /// is running the image that was renamed out of the way.
    #[test]
    fn the_window_beside_the_binaries_is_the_one_that_was_replaced() {
        assert_eq!(
            decide(
                Path::new("/opt/mixengine"),
                &["mix".to_owned(), NAME.to_owned()],
                Path::new("/opt/mixengine/mixlab"),
            ),
            Relaunch::Relaunching
        );
    }

    /// The name comes from this crate's own manifest, which is what `packaging/common.sh`'s
    /// `MIX_WINDOW` is held to — so the payload's `provides` key and this cannot disagree.
    #[test]
    fn the_name_this_window_answers_to_is_its_package_name() {
        assert_eq!(NAME, "mixlab");
    }
}

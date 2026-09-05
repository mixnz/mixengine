//! Where MixEngine's root directory goes when the user has not chosen one.

use std::path::PathBuf;

use crate::Result;

/// The OS convention for "application data belonging to this user".
///
/// Only the *default* is platform business. What lives inside the root — `runtimes/`, `etc/`,
/// `mixengine.db` — is identical everywhere and therefore belongs to `mixengine-core`.
pub trait HomeDirs: std::fmt::Debug + Send + Sync {
    /// The default `MIXENGINE_HOME` for the current user.
    ///
    /// Per `.claude/architecture/overview.md`:
    ///
    /// | OS | Directory | A build that is not a release |
    /// | --- | --- | --- |
    /// | Windows | `%LOCALAPPDATA%\MixEngine` | `%LOCALAPPDATA%\MixEngine-dev` |
    /// | macOS | `~/Library/Application Support/MixEngine` | `…/MixEngine-dev` |
    /// | Linux | `$XDG_DATA_HOME/mixengine`, falling back to `~/.local/share/mixengine` | `…/mixengine-dev` |
    ///
    /// The second column is [`crate::RELEASE`]'s doing and is not a mode anything selects at run
    /// time: it is decided when the binary is compiled — T95.
    ///
    /// The directory is **not** created here and may not exist yet; bootstrapping it is the
    /// caller's job.
    ///
    /// # Errors
    ///
    /// [`Error::NoHomeDirectory`](crate::Error::NoHomeDirectory) when the environment does not say
    /// where the user's data lives.
    fn default_home(&self) -> Result<PathBuf>;
}

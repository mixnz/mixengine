//! Linux: `/usr/local/libexec/mixengine`.

use std::path::PathBuf;

use crate::Result;

/// Root-owned on every Linux, and the same path the `.deb` and the `.rpm` write to.
///
/// **One lookup path per system, whatever put the file there** — the T85 design, D3. A distribution
/// package writing under `/usr/local` is against Debian policy and is deliberate: these packages are
/// published by us and installed by hand, and a daemon that had to look in two places depending on
/// how MixEngine arrived is a daemon with two answers to the question of which file it runs as root.
///
/// `libexec` rather than `bin` because nobody runs this by hand: it is started by the elevation
/// prompt with one argument, and by nothing else.
const HELPER: &str = "/usr/local/libexec/mixengine/mixengine-elevate";

pub(crate) fn helper_path() -> Result<PathBuf> {
    Ok(PathBuf::from(HELPER))
}

/// What to tell a person who is missing the helper on this system.
///
/// **The `.deb` and the `.rpm` write straight to [`HELPER`] and never beside `mixengined`** — same
/// reasoning as macOS's sibling function: a distribution package runs as root during install and
/// writes the final path directly, leaving no bootstrap copy for
/// `mixengine_core::elevation::helper`'s fallback once the installed one is gone. The AppImage is
/// the one Linux format where the two do sit together, but it is not the common case this advice is
/// written for.
pub(crate) fn missing_helper_advice() -> &'static str {
    "the .deb or .rpm installer writes mixengine-elevate straight into \
     /usr/local/libexec/mixengine, never beside mixengined — reinstall the package to put it back"
}

#[cfg(feature = "elevated")]
pub(crate) use crate::unix::install::own_as_root;

/// `/usr/local/libexec/mixengine` is MixEngine's own directory and goes with the file it holds —
/// which is why this passes `true` where macOS passes `false`.
#[cfg(feature = "elevated")]
pub(crate) fn remove_helper() -> Result<crate::install::HelperRemoval> {
    crate::unix::install::remove(&helper_path()?, true)
}

/// The executable bit an archive may not have carried — roadmap task **T88**.
pub(crate) use crate::unix::install::make_executable;

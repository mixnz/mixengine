//! macOS: `/Library/PrivilegedHelperTools`, and emphatically not `/usr/local`.

use std::path::PathBuf;

use crate::Result;

/// Where macOS puts a privileged helper: the directory `SMJobBless` installs into, `root:wheel`,
/// and claimed by no package manager.
///
/// **`/usr/local` was the draft and is wrong on this system** — the T85 design, D3. Homebrew on an
/// Intel Mac takes ownership of `/usr/local` and everything under it for the installing user, which
/// makes it the one directory here where a "root-owned" helper would be nothing of the kind. On
/// Apple Silicon Homebrew uses `/opt/homebrew` and leaves `/usr/local` absent, so the same constant
/// would also mean two different things on two Macs.
///
/// The directory is flat by convention, so the file carries the reverse-DNS name rather than a bare
/// one that could collide with somebody else's helper.
const HELPER: &str = "/Library/PrivilegedHelperTools/dev.mixengine.elevate";

pub(crate) fn helper_path() -> Result<PathBuf> {
    Ok(PathBuf::from(HELPER))
}

/// The one directory the `.pkg` installs the command line into.
///
/// `packaging/common.sh`'s `MIX_INSTALL_MACOS`. `/usr/local/bin` and not `/usr/bin`: the `.pkg` is
/// not a system package manager's, and `/usr/local` is where a Mac expects one that is not.
const BIN: &str = "/usr/local/bin";

/// Where the `.pkg` and the portable tarball put MixEngine's programs — roadmap task **T107**.
///
/// **The window is not here**: a `.pkg` puts `MixLab.app` in `/Applications`, which is
/// [`window_dirs`]'s whole reason for existing.
pub(crate) fn program_dirs() -> Vec<PathBuf> {
    vec![PathBuf::from(BIN)]
}

/// What to tell a person who is missing the helper on this system.
///
/// **The `.pkg` writes straight to [`HELPER`] and never beside `mixengined`** — it runs as root
/// during install and can, so there is no bootstrap copy in `/usr/local/bin` for
/// `mixengine_core::elevation::helper`'s fallback to find once the installed one is gone (a
/// `mix uninstall`, say). Reinstalling is therefore the only way back, unlike Windows and the
/// portable archives, where the two live side by side.
pub(crate) fn missing_helper_advice() -> &'static str {
    "the .pkg installer writes mixengine-elevate straight into /Library/PrivilegedHelperTools, \
     never beside mixengined — reinstall the .pkg to put it back"
}

#[cfg(feature = "elevated")]
pub(crate) use crate::unix::install::own_as_root;

/// `/Library/PrivilegedHelperTools` is shared with every other product that installs a helper there,
/// so the file goes and the directory stays — which is why this passes `false` where Linux passes
/// `true`. The same fact that made the directory the right place to install into makes it the wrong
/// one to remove.
#[cfg(feature = "elevated")]
pub(crate) fn remove_helper() -> Result<crate::install::HelperRemoval> {
    crate::unix::install::remove(&helper_path()?, false)
}

/// The executable bit an archive may not have carried — roadmap task **T88**.
pub(crate) use crate::unix::install::make_executable;

/// What a desktop application is called on disk here — roadmap task **T106**.
///
/// The bundle, always. macOS wraps a windowed application in a directory,
/// `packaging/macos/build.sh` places that directory in `/Applications` and `packaging/feed.sh` names
/// it in the payload's `provides`, so it is what `mixengine_core::updates::apply::swap` has to look
/// for. The executable inside it keeps `executable` as its name and is never the thing an installer
/// placed.
pub(crate) fn application_file_name(_executable: &str, bundle: &str) -> String {
    bundle.to_owned()
}

/// The bundle around `executable`, or `executable` itself when there is none.
///
/// **The nearest `.app` walking up and not the outermost**: an application shipped inside another
/// application's `Resources` is still its own application, and the one this process is running. A
/// build with no bundle at all — `cargo tauri dev`, and every `cargo run` — answers the executable,
/// which is the honest answer rather than a failure.
pub(crate) fn application_root(executable: &std::path::Path) -> std::path::PathBuf {
    executable
        .ancestors()
        .find(|ancestor| {
            ancestor
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        })
        .map_or_else(|| executable.to_path_buf(), std::path::Path::to_path_buf)
}

/// The program inside a bundle: `Contents/MacOS/<executable>`, the layout every `.app` has.
///
/// A path that is not a bundle answers itself — `cargo tauri dev` and every `cargo run` produce a
/// bare executable, and a lookup that refused those would be one that only works on a machine with
/// an installer's output on it.
pub(crate) fn application_executable(
    placed: &std::path::Path,
    executable: &str,
) -> std::path::PathBuf {
    if placed
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    {
        return placed.join("Contents").join("MacOS").join(executable);
    }

    placed.to_path_buf()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    /// macOS wraps a desktop application in a directory, and that directory is what an installer
    /// places — so it is the name an updater has to look for beside the binaries.
    #[test]
    fn an_application_is_named_by_its_bundle() {
        assert_eq!(
            super::application_file_name("mixlab", "MixLab.app"),
            "MixLab.app"
        );
    }

    #[test]
    fn the_root_of_a_bundled_executable_is_the_bundle() {
        assert_eq!(
            super::application_root(Path::new("/Applications/MixLab.app/Contents/MacOS/mixlab")),
            PathBuf::from("/Applications/MixLab.app")
        );
    }

    /// `cargo tauri dev` builds the executable with no bundle around it, and a window started that
    /// way must answer something rather than panic.
    #[test]
    fn an_unbundled_executable_is_its_own_root() {
        assert_eq!(
            super::application_root(Path::new("/work/target/release/mixlab")),
            PathBuf::from("/work/target/release/mixlab")
        );
    }

    /// The bundle's own layout, spelled out on the one system where it is not the identity.
    #[test]
    fn the_program_inside_a_bundle_is_three_components_down() {
        assert_eq!(
            super::application_executable(Path::new("/Applications/MixLab.app"), "mixlab"),
            PathBuf::from("/Applications/MixLab.app/Contents/MacOS/mixlab")
        );
        assert_eq!(
            super::application_executable(Path::new("/work/target/release/mixlab"), "mixlab"),
            PathBuf::from("/work/target/release/mixlab")
        );
    }

    /// The nearest bundle and not the outermost: an application inside another application's
    /// `Resources` is still its own application.
    #[test]
    fn the_nearest_bundle_wins() {
        assert_eq!(
            super::application_root(Path::new(
                "/A.app/Contents/Resources/B.app/Contents/MacOS/b"
            )),
            PathBuf::from("/A.app/Contents/Resources/B.app")
        );
    }
}

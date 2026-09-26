//! macOS and Linux: download the window's installer, check it, and hand it to the system — spec D5.
//! Nothing here elevates: the installer asks for the password itself.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::error::AppError;
use crate::modules::mixengine::for_update;

use super::feed::Feed;
use super::placement::Placement;
use super::stage;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandedOver {
    pub path: PathBuf,
    /// The command that installs it by hand, for a software centre that will not.
    pub command: String,
    /// Whether a graphical installer was opened. `false` over SSH or with no desktop session.
    pub opened: bool,
}

pub fn install_command(kind: &str, path: &Path) -> String {
    let quoted = format!("'{}'", path.display());
    match kind {
        "pkg" => format!("sudo installer -pkg {quoted} -target /"),
        "deb" => format!("sudo apt install {quoted}"),
        _ => format!("sudo dnf install {quoted}"),
    }
}

/// `CFBundleShortVersionString` out of an `Info.plist` written as XML, which is how Tauri writes it.
pub fn parse_plist_version(plist: &str) -> Option<String> {
    let after = plist
        .split("<key>CFBundleShortVersionString</key>")
        .nth(1)?;
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")? + start;
    Some(after[start..end].trim().to_owned())
}

/// The version the installer has put on disk, read the way spec D5 says for each kind.
pub fn version_on_disk(placement: &Placement) -> Option<String> {
    let Placement::Installer { installer, package } = placement else {
        return None;
    };
    match installer.as_str() {
        "pkg" => {
            let root = &crate::relaunch::origin()?.root;
            parse_plist_version(&std::fs::read_to_string(root.join("Contents/Info.plist")).ok()?)
        }
        "deb" => query(
            "dpkg-query",
            &["-W", "-f", "${Version}", package.as_deref()?],
        ),
        "rpm" => query("rpm", &["-q", "--qf", "%{VERSION}", package.as_deref()?]),
        _ => None,
    }
}

fn query(program: &str, args: &[&str]) -> Option<String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    let output = crate::platform::hide_console(&mut command).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (output.status.success() && !text.is_empty()).then_some(text)
}

/// Download the window's installer of `kind`, check it, and open it. Stops nothing.
pub async fn hand_over<R: Runtime>(
    app: &AppHandle<R>,
    feed: &Feed,
    kind: &str,
    progress: impl Fn(u64, u64),
) -> Result<HandedOver, AppError> {
    let (os, arch) = super::host();
    let installer = feed
        .installer(os, arch, kind)
        .ok_or_else(|| err!("error.updateNoBuild"))?;
    let name = installer
        .url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("mixlab-installer");
    let path = super::install::updates_dir(app)?
        .join(&feed.version)
        .join(name);

    stage::download(
        &reqwest::Client::new(),
        &installer.url,
        &installer.sha256,
        &path,
        progress,
    )
    .await
    .map_err(|e| err!("error.updateFailed", message = e))?;

    let opener = if os == "macos" { "open" } else { "xdg-open" };
    let mut command = std::process::Command::new(opener);
    command.arg(&path);
    let opened = crate::platform::hide_console(&mut command)
        .status()
        .is_ok_and(|status| status.success());

    Ok(HandedOver {
        command: install_command(kind, &path),
        path,
        opened,
    })
}

/// After the installer: a running daemon is still the old image, so it is stopped, started again
/// from the new files and its services restored; then the window relaunches. A daemon that was
/// not running is left that way.
pub async fn finish<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppError> {
    if for_update::running().await {
        let directory =
            for_update::daemon_directory().ok_or_else(|| err!("error.updateDaemonNotBack"))?;
        let services = for_update::stop().await?;
        for_update::start_again(&directory, &services)
            .await
            .map_err(|e| err!("error.updateDaemonNotBack").caused_by(e))?;
    }
    crate::relaunch::restart(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn each_kind_has_the_command_that_installs_it_by_hand() {
        assert_eq!(
            install_command("pkg", Path::new("/tmp/mixlab.pkg")),
            "sudo installer -pkg '/tmp/mixlab.pkg' -target /"
        );
        assert_eq!(
            install_command("deb", Path::new("/tmp/m.deb")),
            "sudo apt install '/tmp/m.deb'"
        );
        assert_eq!(
            install_command("rpm", Path::new("/tmp/m.rpm")),
            "sudo dnf install '/tmp/m.rpm'"
        );
    }

    #[test]
    fn the_bundle_version_is_read_from_info_plist() {
        let plist = "<plist><dict>\n<key>CFBundleShortVersionString</key>\n\t<string>0.0.10</string>\n</dict></plist>";
        assert_eq!(parse_plist_version(plist), Some("0.0.10".to_owned()));
        assert_eq!(parse_plist_version("<plist/>"), None);
    }
}

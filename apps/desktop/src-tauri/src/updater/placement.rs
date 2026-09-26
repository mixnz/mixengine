//! What kind of install this window is, and so how it is updated — spec D3.
//!
//! Read from `relaunch::origin()`, which was captured before anything could be swapped. Each
//! receipt probe is one process, run once per window start.

use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// The receipt the macOS `.pkg` installs under (`packaging/macos/build.sh`'s `--identifier`).
pub const PKG_RECEIPT: &str = "dev.mixengine.cli";

/// What the write probe creates and removes, named so a person who finds one knows what wrote it.
const PROBE_FILE: &str = ".mixlab-update-probe";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Placement {
    /// A debug build, or one run out of a Cargo `target/` directory. Never updated.
    Development,
    /// Windows: the directory holding the window is this account's to write.
    Swap { directory: PathBuf },
    /// macOS `.pkg`, Linux `.deb` / `.rpm`: the next installer of the same kind updates it.
    Installer {
        installer: String,
        package: Option<String>,
    },
    /// Something else put this copy here, and something else updates it.
    Elsewhere,
}

/// Everything [`classify`] decides from: read by [`read`] on a real machine, written by hand in
/// tests.
#[derive(Debug, Clone)]
pub struct Probes {
    pub debug_build: bool,
    pub root: PathBuf,
    pub os: &'static str,
    pub writable: bool,
    pub receipt: Option<String>,
}

pub fn classify(probes: &Probes) -> Placement {
    let in_target = probes
        .root
        .components()
        .any(|c| matches!(c, Component::Normal(name) if name == "target"));
    if probes.debug_build || in_target {
        return Placement::Development;
    }

    match (probes.os, probes.receipt.as_deref()) {
        ("windows", _) if probes.writable => match probes.root.parent() {
            Some(directory) => Placement::Swap {
                directory: directory.to_path_buf(),
            },
            None => Placement::Elsewhere,
        },
        ("macos", Some(PKG_RECEIPT)) => Placement::Installer {
            installer: "pkg".to_owned(),
            package: None,
        },
        ("linux", Some(receipt)) => match receipt.split_once(':') {
            Some(("dpkg", package)) if !package.is_empty() => Placement::Installer {
                installer: "deb".to_owned(),
                package: Some(package.to_owned()),
            },
            Some(("rpm", package)) if !package.is_empty() => Placement::Installer {
                installer: "rpm".to_owned(),
                package: Some(package.to_owned()),
            },
            _ => Placement::Elsewhere,
        },
        _ => Placement::Elsewhere,
    }
}

/// This machine's answer, from the path the window was started from.
pub fn read() -> Placement {
    let Some(origin) = crate::relaunch::origin() else {
        return Placement::Elsewhere;
    };
    let os = std::env::consts::OS;
    let directory = origin.root.parent().unwrap_or(Path::new("."));
    let executable = &origin.executable;
    let receipt = match os {
        "macos" => run("pkgutil", &["--file-info"], executable).and_then(|o| parse_pkgutil(&o)),
        "linux" => run("dpkg", &["-S"], executable)
            .and_then(|o| parse_dpkg(&o))
            .or_else(|| {
                run("rpm", &["-qf", "--qf", "%{NAME}\n"], executable).and_then(|o| parse_rpm(&o))
            }),
        _ => None,
    };
    classify(&Probes {
        debug_build: cfg!(debug_assertions),
        root: origin.root.clone(),
        os,
        writable: os == "windows" && probe(directory).is_ok(),
        receipt,
    })
}

/// Create and remove one file: whether this account can write here, asked of the machine itself.
fn probe(directory: &Path) -> std::io::Result<()> {
    let path = directory.join(PROBE_FILE);
    let _ = std::fs::remove_file(&path);
    std::fs::write(&path, b"")?;
    std::fs::remove_file(&path)
}

/// Run one probe and return its stdout, or `None` when it could not run or said no.
fn run(program: &str, args: &[&str], path: &Path) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args).arg(path);
    let output = crate::platform::hide_console(&mut command).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `pkgutil --file-info`'s `pkgid:` line.
pub fn parse_pkgutil(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.strip_prefix("pkgid: "))
        .map(|id| id.trim().to_owned())
}

/// `dpkg -S`'s `package[:arch]: path` line, as `dpkg:<package>`.
pub fn parse_dpkg(output: &str) -> Option<String> {
    // The owner line names a path, which is absolute; `dpkg-query`'s refusal names a pattern.
    let (owner, path) = output.lines().next()?.split_once(": ")?;
    if !path.starts_with('/') {
        return None;
    }
    let package = owner.split(':').next()?.trim();
    (!package.is_empty() && !package.contains(' ')).then(|| format!("dpkg:{package}"))
}

/// `rpm -qf --qf '%{NAME}\n'`'s one line, as `rpm:<package>`.
pub fn parse_rpm(output: &str) -> Option<String> {
    let name = output.lines().next()?.trim();
    (!name.is_empty() && !name.contains(' ')).then(|| format!("rpm:{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn probes(os: &'static str) -> Probes {
        Probes {
            debug_build: false,
            root: PathBuf::from("/opt/MixLab/mixlab"),
            os,
            writable: false,
            receipt: None,
        }
    }

    #[test]
    fn a_debug_build_is_never_updated() {
        let mut p = probes("windows");
        p.debug_build = true;
        p.writable = true;
        assert_eq!(classify(&p), Placement::Development);
    }

    #[test]
    fn a_window_inside_a_cargo_target_directory_is_development() {
        let mut p = probes("windows");
        p.root = PathBuf::from("/src/mixlab/apps/desktop/src-tauri/target/release/mixlab.exe");
        p.writable = true;
        assert_eq!(classify(&p), Placement::Development);
    }

    #[test]
    fn a_writable_windows_directory_is_swapped_in_place() {
        let mut p = probes("windows");
        p.root = PathBuf::from("/Users/a/AppData/Local/Programs/MixEngine/mixlab.exe");
        p.writable = true;
        assert_eq!(
            classify(&p),
            Placement::Swap {
                directory: PathBuf::from("/Users/a/AppData/Local/Programs/MixEngine")
            }
        );
    }

    #[test]
    fn the_pkg_receipt_is_handed_to_installer_app() {
        let mut p = probes("macos");
        p.receipt = Some("dev.mixengine.cli".to_owned());
        assert_eq!(
            classify(&p),
            Placement::Installer {
                installer: "pkg".to_owned(),
                package: None
            }
        );
    }

    #[test]
    fn a_linux_package_is_handed_to_its_package_manager() {
        let mut p = probes("linux");
        p.receipt = Some("dpkg:mixlab".to_owned());
        assert_eq!(
            classify(&p),
            Placement::Installer {
                installer: "deb".to_owned(),
                package: Some("mixlab".to_owned())
            }
        );
        p.receipt = Some("rpm:mixlab".to_owned());
        assert_eq!(
            classify(&p),
            Placement::Installer {
                installer: "rpm".to_owned(),
                package: Some("mixlab".to_owned())
            }
        );
    }

    #[test]
    fn anything_else_is_elsewhere() {
        assert_eq!(classify(&probes("macos")), Placement::Elsewhere);
        assert_eq!(classify(&probes("linux")), Placement::Elsewhere);
        assert_eq!(classify(&probes("windows")), Placement::Elsewhere);
    }

    #[test]
    fn the_three_receipt_answers_parse() {
        assert_eq!(
            parse_pkgutil(
                "volume: /\npath: /Applications/MixLab.app/Contents/MacOS/mixlab\n\npkgid: dev.mixengine.cli\npkg-version: 0.0.9\n"
            ),
            Some("dev.mixengine.cli".to_owned())
        );
        assert_eq!(parse_pkgutil("no receipt\n"), None);
        assert_eq!(
            parse_dpkg("mixlab: /usr/bin/mixlab\n"),
            Some("dpkg:mixlab".to_owned())
        );
        assert_eq!(
            parse_dpkg("mixlab:amd64: /usr/bin/mixlab\n"),
            Some("dpkg:mixlab".to_owned())
        );
        assert_eq!(
            parse_dpkg("dpkg-query: no path found matching pattern /x\n"),
            None
        );
        assert_eq!(parse_rpm("mixlab\n"), Some("rpm:mixlab".to_owned()));
        assert_eq!(parse_rpm("file /x is not owned by any package\n"), None);
    }
}

//! What MixEngine knows about a JDK that the index does not say — roadmap task **T27e**.

use std::path::{Path, PathBuf};

/// The variables a JVM reads before its own arguments, removed from every JVM the daemon starts
/// for itself — the design's D3. A malformed `_JAVA_OPTIONS` in the daemon's own environment would
/// otherwise fail every JDK's install for a reason that has nothing to do with the JDK.
pub const UNSET: &[&str] = &[
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "CLASSPATH",
    "JAVA_HOME",
];

/// `JAVA_HOME` for the JDK whose `java` is `java` — two directories up, which is `Contents/Home` on
/// macOS and the archive root elsewhere (the design's D5).
///
/// [`None`] for a path with no directory two levels above it: an empty path is not a home, and
/// naming one would point `JAVA_HOME` at whatever directory a program happened to start in.
#[must_use]
pub fn home(java: &Path) -> Option<PathBuf> {
    java.parent()?
        .parent()
        .filter(|home| !home.as_os_str().is_empty())
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_is_two_directories_above_java() {
        let root = Path::new("runtimes").join("java").join("21.0.12.1");

        assert_eq!(home(&root.join("bin").join("java")), Some(root.clone()));

        let bundle = root.join("Contents").join("Home");
        assert_eq!(home(&bundle.join("bin").join("java")), Some(bundle));
    }

    #[test]
    fn a_path_with_nowhere_above_it_has_no_home() {
        assert_eq!(home(Path::new("java")), None);
        assert_eq!(home(&Path::new("bin").join("java")), None);
    }
}

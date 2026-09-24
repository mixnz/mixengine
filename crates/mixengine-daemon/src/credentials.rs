//! Which credential store this daemon keeps passwords in — roadmap task **T183**, ADR 0051.
//!
//! **Decided by where the binary came from**, the way ADR 0024 decides the default home: a release
//! keeps the operating system's store, and anything else keeps a file in its own home, so an
//! unsigned build is never a stranger asking the Keychain for somebody else's password. One flag
//! overrides it, and a release refuses the override that would put its passwords in a file.

use std::path::Path;

use mixengine_platform::Credentials;

/// What `--credential-store` accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum Store {
    /// The operating system's credential store.
    Os,
    /// `<root>/credentials.json`.
    Home,
}

/// The store this daemon uses, or why it will not start.
///
/// # Errors
///
/// A sentence for stderr when a release is asked to keep its credentials in a file.
pub(crate) fn choose(release: bool, asked: Option<Store>) -> Result<Store, String> {
    match (release, asked) {
        (true, Some(Store::Home)) => Err(
            "--credential-store home is for development builds: a release keeps its passwords in \
             the operating system's credential store, and will not start keeping them in a file"
                .to_owned(),
        ),
        (_, Some(store)) => Ok(store),
        (true, None) => Ok(Store::Os),
        (false, None) => Ok(Store::Home),
    }
}

impl Store {
    /// What the platform layer is handed.
    pub(crate) fn at(self, credentials_file: &Path) -> Credentials {
        match self {
            Self::Os => Credentials::Os,
            Self::Home => Credentials::File(credentials_file.to_path_buf()),
        }
    }
}

/// The startup log line's words for `credentials`.
pub(crate) fn describe(credentials: &Credentials) -> String {
    match credentials {
        Credentials::Os => "the operating system's credential store".to_owned(),
        Credentials::File(path) => format!("{} (a development build)", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_keeps_the_os_store_and_refuses_a_file() {
        assert_eq!(choose(true, None), Ok(Store::Os));
        assert_eq!(choose(true, Some(Store::Os)), Ok(Store::Os));

        let refused = choose(true, Some(Store::Home)).expect_err("a release in a file");
        assert!(refused.contains("--credential-store home"), "{refused}");
    }

    #[test]
    fn a_development_build_keeps_its_own_file_unless_told_otherwise() {
        assert_eq!(choose(false, None), Ok(Store::Home));
        assert_eq!(choose(false, Some(Store::Home)), Ok(Store::Home));
        assert_eq!(choose(false, Some(Store::Os)), Ok(Store::Os));
    }

    #[test]
    fn the_file_is_the_one_the_home_names() {
        let file = Path::new("/home/me/MixEngine-dev/credentials.json");

        assert_eq!(Store::Home.at(file), Credentials::File(file.to_path_buf()));
        assert_eq!(Store::Os.at(file), Credentials::Os);
    }

    #[test]
    fn the_log_line_says_which_store_and_never_a_value() {
        let file = Path::new("/home/me/MixEngine-dev/credentials.json");

        assert_eq!(
            describe(&Credentials::File(file.to_path_buf())),
            "/home/me/MixEngine-dev/credentials.json (a development build)"
        );
        assert_eq!(
            describe(&Credentials::Os),
            "the operating system's credential store"
        );
    }
}

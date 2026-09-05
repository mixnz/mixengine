//! `%LOCALAPPDATA%\MixEngine`, or `%LOCALAPPDATA%\MixEngine-dev` for a build that is not a release.

use std::path::PathBuf;

use directories::BaseDirs;

use crate::{Error, HomeDirs, Result};

/// Beside the released one rather than somewhere else, so a developer wondering where their sites
/// went finds the answer in the folder they were already looking at — T95, D3.
const NAME: &str = if crate::RELEASE {
    "MixEngine"
} else {
    "MixEngine-dev"
};

#[derive(Debug, Default)]
pub(crate) struct Home;

impl HomeDirs for Home {
    fn default_home(&self) -> Result<PathBuf> {
        // Local, not roaming: the root holds gigabytes of runtimes and databases, and a roaming
        // profile would try to copy all of it between machines at every logon.
        let base = BaseDirs::new().ok_or(Error::NoHomeDirectory {
            reason: "Windows did not return a Local AppData folder for this user",
        })?;
        Ok(base.data_local_dir().join(NAME))
    }
}

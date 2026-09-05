//! `~/Library/Application Support/MixEngine`, or `MixEngine-dev` for a build that is not a
//! release.

use std::path::PathBuf;

use directories::BaseDirs;

use crate::{Error, HomeDirs, Result};

/// Beside the released one — T95, D3.
const NAME: &str = if crate::RELEASE {
    "MixEngine"
} else {
    "MixEngine-dev"
};

#[derive(Debug, Default)]
pub(crate) struct Home;

impl HomeDirs for Home {
    fn default_home(&self) -> Result<PathBuf> {
        let base = BaseDirs::new().ok_or(Error::NoHomeDirectory {
            reason: "$HOME is not set",
        })?;
        Ok(base.data_dir().join(NAME))
    }
}

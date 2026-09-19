//! A default root that the test chose, or none at all.

use std::path::{Path, PathBuf};

use crate::{Error, HomeDirs, Result};

#[derive(Debug)]
pub(super) struct Home {
    default: Option<PathBuf>,

    /// Directories an elevated process "cannot read", and everything under them.
    unreadable: Vec<PathBuf>,
}

impl Home {
    pub(super) fn answering(default: Option<PathBuf>) -> Self {
        Self {
            default,
            unreadable: Vec::new(),
        }
    }
}

impl HomeDirs for Home {
    fn default_home(&self) -> Result<PathBuf> {
        self.default.clone().ok_or(Error::NoHomeDirectory {
            reason: "the mock host was built without one",
        })
    }

    fn elevated_can_read(&self, path: &Path) -> bool {
        !self.unreadable.iter().any(|blind| path.starts_with(blind))
    }
}

impl Home {
    pub(super) fn blind_to(&mut self, path: PathBuf) {
        self.unreadable.push(path);
    }
}

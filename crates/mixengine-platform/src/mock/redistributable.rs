//! The mock's installer — whatever a test said, and it never runs anything.

use std::path::Path;

use crate::{Error, RedistributableOutcome, Redistributables, Result};

/// What this mock will answer.
#[derive(Debug, Default)]
pub(crate) struct Installer(Option<RedistributableOutcome>);

impl Installer {
    /// An installer that ends as `outcome`.
    pub(crate) fn ending(outcome: RedistributableOutcome) -> Self {
        Self(Some(outcome))
    }
}

impl Redistributables for Installer {
    fn install_visual_cpp(&self, _installer: &Path) -> Result<RedistributableOutcome> {
        // The default host is the ordinary test machine: there is no installer to run.
        self.0.ok_or_else(|| Error::UnsupportedPlatform {
            capability: "Redistributables",
            reason: "the mock runs no installer".to_owned(),
        })
    }
}

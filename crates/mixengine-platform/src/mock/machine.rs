//! The mock's machine — whatever a test said.

use crate::{Machine, MachineFacts};

/// What this mock will answer.
#[derive(Debug)]
pub(crate) struct Facts(MachineFacts);

impl Default for Facts {
    /// A machine nothing is known about, which judges as lacking nothing.
    fn default() -> Self {
        Self(MachineFacts::unknown())
    }
}

impl Facts {
    /// A machine that reads as `facts`.
    pub(crate) fn reporting(facts: MachineFacts) -> Self {
        Self(facts)
    }
}

impl Machine for Facts {
    fn facts(&self) -> MachineFacts {
        self.0.clone()
    }
}

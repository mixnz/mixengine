//! MixLab's sync: the key hierarchy, the record envelope, and the transport above them.
//!
//! **Nothing here touches the network, the disk or the credential store.** [`crypto`] is arithmetic
//! over byte arrays, so the promise that the server cannot read a record is checkable by reading one
//! file rather than by trusting a deployment — the design's D1, and
//! [ADR 0045](https://github.com/mixnz/mixlab/blob/master/docs/decisions/0045-mixlab-has-an-account-and-mixengine-does-not.md).
//!
//! The keyring is [`crate::secrets`]'s and the socket is the transport's; neither is reachable from
//! here, which is what keeps this module reviewable on its own.

pub mod crypto;
pub mod wire;
pub mod merge;
pub mod chunk;

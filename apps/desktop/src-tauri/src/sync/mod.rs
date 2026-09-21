//! MixLab's sync: the key hierarchy, the record envelope, and the transport above them.
//!
//! **Nothing here touches the network, the disk or the credential store.** [`crypto`](crate::sync::crypto) is arithmetic
//! over byte arrays, so the promise that the server cannot read a record is checkable by reading one
//! file rather than by trusting a deployment — the design's D1, and
//! [ADR 0045](https://github.com/mixnz/mixlab/blob/master/docs/decisions/0045-mixlab-has-an-account-and-mixengine-does-not.md).
//!
//! [`crypto`](crate::sync::crypto) is the key hierarchy and the envelope; [`wire`](crate::sync::wire), [`merge`](crate::sync::merge), [`chunk`](crate::sync::chunk), [`store`](crate::sync::store)
//! and [`transport`](crate::sync::transport) are one concern each; [`engine`](crate::sync::engine) puts them together as `pull` and `push`.
//! **The engine moves ciphertext only** — sealing and opening stay with whoever calls it, so the
//! keyring and a module's plaintext never reach the socket.

pub mod crypto;
pub mod wire;
pub mod merge;
pub mod chunk;
pub mod store;
pub mod transport;
pub mod engine;

//! The key hierarchy and the record envelope — the design's D2 and D3.
//!
//! **Every label below is frozen.** A domain-separation string that changes makes every record
//! written under the old one undecryptable, which is why each carries `/v1` and why
//! [`tests::the_domain_separation_labels_are_frozen`] exists: it fails if anybody edits one.

use crate::error::AppError;
use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Wraps the master key under the password-derived key.
pub const INFO_WRAP: &[u8] = b"mixlab-sync/wrap/v1";
/// The value the server stores a keyed hash of. Knowing it does not yield [`INFO_WRAP`]'s key.
pub const INFO_AUTH: &[u8] = b"mixlab-sync/auth/v1";
/// Encrypts record payloads.
pub const INFO_DATA: &[u8] = b"mixlab-sync/data/v1";
/// Keys the HMAC that turns a local name into an opaque address.
pub const INFO_ID: &[u8] = b"mixlab-sync/id/v1";
/// Wraps the master key under the recovery key.
pub const INFO_RECOVERY: &[u8] = b"mixlab-sync/recovery/v1";

/// Argon2id's memory, in KiB. 64 MiB — the design's D2.
pub const ARGON_M_COST: u32 = 65_536;
/// Argon2id's passes.
pub const ARGON_T_COST: u32 = 3;
/// Argon2id's lanes.
pub const ARGON_P_COST: u32 = 4;

/// What a password becomes.
///
/// Two HKDF expansions of one Argon2id output: knowing either tells you nothing about the other,
/// which is what lets [`PasswordKeys::auth`] be sent to a server that must never hold the means to
/// open a record.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct PasswordKeys {
    /// Wraps and unwraps the master key. Never leaves this machine.
    pub wrap: [u8; 32],
    /// Sent to the server, which stores a keyed hash of it.
    pub auth: [u8; 32],
}

/// One HKDF-SHA256 expansion to 32 bytes.
///
/// Infallible at this length — HKDF's ceiling is 255 hash lengths — and the `expect` says so rather
/// than handing every caller an error that cannot happen.
fn expand(ikm: &[u8], info: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(None, ikm)
        .expand(info, &mut out)
        .expect("32 bytes is far below HKDF-SHA256's ceiling");
    out
}

/// Stretch the password, then split it in two.
///
/// The cost is the design's D2 and is deliberately felt: 64 MiB and three passes is what makes a
/// stolen server database expensive rather than a wordlist away. It is also the only expensive step
/// in this module, and it is on the one secret a person chose.
pub fn derive_password_keys(password: &str, salt: &[u8]) -> Result<PasswordKeys, AppError> {
    let params = Params::new(ARGON_M_COST, ARGON_T_COST, ARGON_P_COST, Some(32))
        .map_err(|e| err!("error.syncKeyDerivation", message = e))?;

    let mut stretched = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut stretched)
        .map_err(|e| err!("error.syncKeyDerivation", message = e))?;

    let keys = PasswordKeys {
        wrap: expand(&stretched, INFO_WRAP),
        auth: expand(&stretched, INFO_AUTH),
    };
    stretched.zeroize();
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **A failure here is not a test to update.** These strings are in released ciphertext; a
    /// change to one is a new `/v2` and a migration, not an edit.
    #[test]
    fn the_domain_separation_labels_are_frozen() {
        assert_eq!(INFO_WRAP, b"mixlab-sync/wrap/v1");
        assert_eq!(INFO_AUTH, b"mixlab-sync/auth/v1");
        assert_eq!(INFO_DATA, b"mixlab-sync/data/v1");
        assert_eq!(INFO_ID, b"mixlab-sync/id/v1");
        assert_eq!(INFO_RECOVERY, b"mixlab-sync/recovery/v1");
        assert_eq!((ARGON_M_COST, ARGON_T_COST, ARGON_P_COST), (65_536, 3, 4));
    }

    #[test]
    fn the_two_password_keys_differ_and_are_reproducible() {
        let salt = [7u8; 16];
        let first = derive_password_keys("correct horse", &salt).expect("derives");
        let again = derive_password_keys("correct horse", &salt).expect("derives");

        assert_eq!(
            first.wrap, again.wrap,
            "the same password and salt must agree"
        );
        assert_eq!(first.auth, again.auth);
        assert_ne!(
            first.wrap, first.auth,
            "auth reaches the server; it must not be the key that opens the vault"
        );

        let other = derive_password_keys("correct horse", &[8u8; 16]).expect("derives");
        assert_ne!(
            first.wrap, other.wrap,
            "a different salt is a different account"
        );
    }
}

//! The key hierarchy and the record envelope — the design's D2 and D3.
//!
//! **Every label below is frozen.** A domain-separation string that changes makes every record
//! written under the old one undecryptable, which is why each carries `/v1` and why
//! [`tests::the_domain_separation_labels_are_frozen`] exists: it fails if anybody edits one.

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
}

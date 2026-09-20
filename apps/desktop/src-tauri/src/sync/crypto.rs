//! The key hierarchy and the record envelope — the design's D2 and D3.
//!
//! **Every label below is frozen.** A domain-separation string that changes makes every record
//! written under the old one undecryptable, which is why each carries `/v1` and why
//! [`tests::the_domain_separation_labels_are_frozen`] exists: it fails if anybody edits one.

use crate::error::AppError;
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand::TryRngCore;
use rand::rngs::OsRng;
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

/// How many bytes an XChaCha20-Poly1305 nonce is, and therefore what a sealed value starts with.
pub const NONCE_LEN: usize = 24;

/// `N` bytes from the operating system.
///
/// A failure here is not a case to handle: a machine whose randomness is unavailable cannot be
/// given a key at all, and carrying on with a predictable one would be the worse answer.
fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    OsRng
        .try_fill_bytes(&mut out)
        .expect("the operating system's randomness is not optional");
    out
}

/// A fresh master key.
///
/// **Random rather than derived from the password**, which is the whole reason changing a password
/// re-wraps 32 bytes instead of re-encrypting an account — the design's D2.
pub fn new_master_key() -> [u8; 32] {
    random::<32>()
}

/// `nonce || ciphertext`, sealed under `wrapping`.
///
/// No associated data: a wrapped master key is not addressed by anything, unlike a record — see
/// [`seal_record`]'s argument for why that one is.
pub fn wrap_master_key(wrapping: &[u8; 32], master: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    let nonce = random::<NONCE_LEN>();
    let sealed = XChaCha20Poly1305::new(wrapping.into())
        .encrypt(XNonce::from_slice(&nonce), master.as_slice())
        .map_err(|_| err!("error.syncCannotWrapKey"))?;

    let mut out = Vec::with_capacity(NONCE_LEN + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// The inverse.
///
/// A wrong key, a truncated value and a flipped byte all end here as the same error. There is
/// nothing useful to tell apart, and saying which went wrong would be a hint.
pub fn unwrap_master_key(wrapping: &[u8; 32], sealed: &[u8]) -> Result<[u8; 32], AppError> {
    let (nonce, body) = sealed
        .split_at_checked(NONCE_LEN)
        .ok_or_else(|| err!("error.syncCannotUnwrapKey"))?;

    XChaCha20Poly1305::new(wrapping.into())
        .decrypt(XNonce::from_slice(nonce), body)
        .map_err(|_| err!("error.syncCannotUnwrapKey"))?
        .try_into()
        .map_err(|_| err!("error.syncCannotUnwrapKey"))
}

/// Crockford's alphabet: the digits and the letters, less `I`, `L`, `O` and `U`.
///
/// Nothing here can be mistaken for a digit in somebody's handwriting, which is the whole point of
/// a value whose only copy is on paper.
const BASE32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// How many characters 32 bytes become at five bits each, rounded up.
const RECOVERY_CHARS: usize = 52;
/// How many of those go between separators.
const RECOVERY_GROUP: usize = 4;

/// A fresh recovery key. The same 32 bytes as a master key, and it protects one.
pub fn new_recovery_key() -> [u8; 32] {
    random::<32>()
}

/// What actually wraps the master key.
///
/// The recovery key is what a person holds; this is what it becomes, so that the secret on paper
/// and the secret in the ciphertext are not the same bytes.
pub fn recovery_wrapping_key(key: &[u8; 32]) -> [u8; 32] {
    expand(key, INFO_RECOVERY)
}

/// 52 characters in 13 groups of four, separated by `-`.
///
/// Thirteen groups of four rather than the ten groups of five an early draft of the design asked
/// for: fifty characters carry 250 bits and this key is 256.
pub fn format_recovery_key(key: &[u8; 32]) -> String {
    let mut chars = String::with_capacity(RECOVERY_CHARS);
    let mut acc = 0u16;
    let mut bits = 0u8;

    for byte in key {
        acc = (acc << 8) | u16::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            chars.push(BASE32[usize::from((acc >> bits) & 0b1_1111)] as char);
        }
    }
    if bits > 0 {
        chars.push(BASE32[usize::from((acc << (5 - bits)) & 0b1_1111)] as char);
    }

    chars
        .as_bytes()
        .chunks(RECOVERY_GROUP)
        .map(|chunk| std::str::from_utf8(chunk).expect("the alphabet is ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// The inverse, forgiving about how it was typed: any case, and any separator at all.
///
/// Forgiving about spacing and strict about everything else — a value read off paper is retyped
/// with whatever spacing the reader felt like, but a character outside the alphabet means they have
/// the wrong thing in front of them and should be told so.
pub fn parse_recovery_key(text: &str) -> Result<[u8; 32], AppError> {
    let mut key = [0u8; 32];
    let mut acc = 0u16;
    let mut bits = 0u8;
    let mut written = 0usize;

    for ch in text.chars().filter(|c| c.is_ascii_alphanumeric()) {
        let upper = ch.to_ascii_uppercase() as u8;
        let value = BASE32
            .iter()
            .position(|c| *c == upper)
            .ok_or_else(|| err!("error.syncRecoveryKeyUnreadable"))?;

        acc = (acc << 5) | value as u16;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            if written == key.len() {
                return Err(err!("error.syncRecoveryKeyUnreadable"));
            }
            key[written] = ((acc >> bits) & 0xFF) as u8;
            written += 1;
        }
    }

    match written == key.len() {
        true => Ok(key),
        false => Err(err!("error.syncRecoveryKeyUnreadable")),
    }
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

    #[test]
    fn a_master_key_survives_a_round_trip_and_refuses_the_wrong_key() {
        let master = new_master_key();
        let right = [1u8; 32];
        let wrong = [2u8; 32];

        let sealed = wrap_master_key(&right, &master).expect("wraps");
        assert_eq!(unwrap_master_key(&right, &sealed).expect("unwraps"), master);
        assert!(
            unwrap_master_key(&wrong, &sealed).is_err(),
            "a wrong password must fail, not return rubbish"
        );
    }

    #[test]
    fn wrapping_twice_produces_different_bytes() {
        let master = new_master_key();
        let key = [3u8; 32];
        assert_ne!(
            wrap_master_key(&key, &master).expect("wraps"),
            wrap_master_key(&key, &master).expect("wraps"),
            "a fresh nonce each time, or two wrappings leak that they hold the same key"
        );
    }

    #[test]
    fn a_truncated_wrapping_is_refused_rather_than_panicking() {
        let master = new_master_key();
        let key = [4u8; 32];
        let sealed = wrap_master_key(&key, &master).expect("wraps");

        for cut in [0, 1, NONCE_LEN - 1, NONCE_LEN, sealed.len() - 1] {
            assert!(
                unwrap_master_key(&key, &sealed[..cut]).is_err(),
                "a value cut to {cut} bytes must be an error, never a panic"
            );
        }
    }

    #[test]
    fn a_recovery_key_round_trips_through_what_a_person_would_type() {
        let key = new_recovery_key();
        let shown = format_recovery_key(&key);

        assert_eq!(shown.len(), 52 + 12, "52 characters in 13 groups of four");
        assert_eq!(shown.matches('-').count(), 12);
        assert_eq!(parse_recovery_key(&shown).expect("parses"), key);
    }

    #[test]
    fn a_recovery_key_is_read_back_the_way_it_was_written_down() {
        let key = new_recovery_key();
        let shown = format_recovery_key(&key);

        let sloppy = shown.to_lowercase().replace('-', " ");
        assert_eq!(parse_recovery_key(&sloppy).expect("parses"), key);

        assert!(parse_recovery_key("not a key").is_err(), "too short");
        assert!(
            parse_recovery_key(&format!("{shown}-ABCD")).is_err(),
            "too long"
        );
        let mut outside_the_alphabet = shown.clone();
        outside_the_alphabet.replace_range(0..1, "I");
        assert!(
            parse_recovery_key(&outside_the_alphabet).is_err(),
            "I, L, O and U are not in the alphabet, so one of them means the wrong thing was typed"
        );
    }

    #[test]
    fn the_recovery_key_opens_the_same_master_key() {
        let master = new_master_key();
        let recovery = new_recovery_key();
        let wrapping = recovery_wrapping_key(&recovery);

        let sealed = wrap_master_key(&wrapping, &master).expect("wraps");
        assert_eq!(
            unwrap_master_key(&wrapping, &sealed).expect("unwraps"),
            master
        );
        assert_ne!(
            wrapping, recovery,
            "what a person holds and what wraps the key are not the same secret"
        );
    }
}

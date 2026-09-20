//! What the server needs a cipher for, which is not much: it holds a verifier and hands out
//! tokens. **Nothing here touches a record.** The keys that make a record readable are derived on
//! the machine that wrote it and never arrive.

use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Crockford base32: the alphabet without `I`, `L`, `O` and `U`, so nothing read off a screen is
/// ambiguous. The same one the recovery key uses (D2), so a person learns one way of typing a
/// code from this product rather than two.
const BASE32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_CHARS: usize = 8;

/// A code a person types, shown as `XXXX-XXXX`. Forty bits, which is why guessing is rate limited.
pub fn random_code() -> String {
    let mut bytes = [0u8; CODE_CHARS];
    rand::rng().fill_bytes(&mut bytes);
    let code: String = bytes
        .iter()
        .map(|byte| BASE32[usize::from(*byte) % 32] as char)
        .collect();
    format!("{}-{}", &code[..4], &code[4..])
}

/// Forgiving about case and separators, strict about the alphabet — the rule
/// `parse_recovery_key` already applies on the client. A character outside the alphabet means the
/// person has the wrong thing in front of them and should be told so.
pub fn normalise_code(presented: &str) -> Option<String> {
    let stripped: String = presented
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '-')
        .map(|character| character.to_ascii_uppercase())
        .collect();
    if stripped.len() != CODE_CHARS {
        return None;
    }
    stripped
        .bytes()
        .all(|byte| BASE32.contains(&byte))
        .then_some(stripped)
}

/// 32 random bytes as hex: a session token, a device id. Never something a person types.
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// The stored password verifier: `HMAC(pepper, A)`. `A` already is a verifier — the client derived
/// it and the password is not recoverable from it — so this is not about hashing a password. It is
/// about the pepper living outside the database, so that a database taken on its own is not a list
/// of values that can be replayed against this server.
pub fn peppered(pepper: &str, a: &str) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(pepper.as_bytes())
        .expect("HMAC accepts a key of any length");
    mac.update(a.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Comparison that does not leak where two values first differ. Both arguments are hashes of the
/// same fixed length, so an early return costs nothing that matters — but a verifier comparison is
/// exactly the place where "it was fine in practice" stops being an argument.
pub fn same_secret(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs() as i64)
        .unwrap_or(0)
}

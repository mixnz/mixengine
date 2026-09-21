//! What a body has to look like before anything is done with it.
//!
//! The server validates shapes and lengths and never meaning: it cannot tell whether a ciphertext
//! is a saved query or a connection, and nothing here tries.

/// Standard base64 with padding, which is the one spelling D4a allows.
pub fn is_base64(value: &str, decoded_bytes: Option<usize>) -> bool {
    if value.is_empty() || !value.len().is_multiple_of(4) {
        return false;
    }
    let body = value.trim_end_matches('=');
    if value.len() - body.len() > 2 {
        return false;
    }
    if !body
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
    {
        return false;
    }
    match decoded_bytes {
        None => true,
        Some(expected) => decoded_length(value) == expected,
    }
}

/// Bytes a standard-base64 string stands for, without decoding it.
pub fn decoded_length(value: &str) -> usize {
    let padding = value.len() - value.trim_end_matches('=').len();
    (value.len() / 4) * 3 - padding
}

/// 64 lowercase hex characters, the shape D3 gives a collection and a record.
pub fn is_opaque_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Deliberately loose. An address is a delivery target, not a claim to be parsed: the only real
/// test of it is whether a letter arrives, and a stricter pattern refuses valid addresses far more
/// often than it catches invalid ones.
pub fn is_email(value: &str) -> bool {
    if value.len() > 254 || value.chars().any(char::is_whitespace) {
        return false;
    }
    let mut halves = value.split('@');
    let (Some(local), Some(domain), None) = (halves.next(), halves.next(), halves.next()) else {
        return false;
    };
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

//! Whether a `keyring` failure means this machine has no credential store at all.
//!
//! **The shortest of the three, and the most exact.** `keyring`'s Credential Manager backend spends
//! `NoStorageAccess` on one Windows error and no other: `ERROR_NO_SUCH_LOGON_SESSION`. That is the
//! whole of the absent case here, because the Credential Manager is part of Windows rather than
//! something installed beside it — what a caller can lack is not the store but a logon session to
//! read it under.
//!
//! Which is a shape MixEngine can genuinely meet: a service running as `LocalSystem` or under a
//! virtual account has no user profile loaded, so there is no per-user credential vault to open.

use keyring::error::Error as KeyringError;

/// The workaround for a machine with no credential store, or `None` when it has one.
pub(crate) fn absent_store(source: &KeyringError) -> Option<&'static str> {
    matches!(source, KeyringError::NoStorageAccess(_)).then_some(
        "this process has no logon session, so Windows has no per-user Credential Manager vault to \
         open — run MixEngine as a signed-in user rather than as a service account without a \
         loaded profile",
    )
}

/// The keys under `service` — T186.
///
/// `keyring` names every generic credential it writes `<key>.<service>`. `CredEnumerateW`'s filter
/// takes a prefix and nothing else, so this lists every credential of this user and keeps the ones
/// ending in `.<service>`.
#[expect(
    unsafe_code,
    reason = "`CredEnumerateW` and `CredFree` are the only way to list the Credential Manager"
)]
pub(crate) fn keys(service: &str) -> Result<Vec<String>, KeyringError> {
    use windows_sys::Win32::Foundation::{
        ERROR_NO_SUCH_LOGON_SESSION, ERROR_NOT_FOUND, GetLastError,
    };
    use windows_sys::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredEnumerateW, CredFree,
    };

    let suffix = format!(".{service}");
    let mut count = 0u32;
    let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();

    // SAFETY: a null filter lists everything; `count` and `list` are written by the call.
    if unsafe { CredEnumerateW(std::ptr::null(), 0, &mut count, &mut list) } == 0 {
        // SAFETY: read straight after the failing call, on the same thread.
        let code = unsafe { GetLastError() };
        let error = Box::new(std::io::Error::from_raw_os_error(code.cast_signed()));

        return match code {
            ERROR_NOT_FOUND => Ok(Vec::new()),
            ERROR_NO_SUCH_LOGON_SESSION => Err(KeyringError::NoStorageAccess(error)),
            _ => Err(KeyringError::PlatformFailure(error)),
        };
    }

    let mut keys = Vec::new();

    // SAFETY: on success `list` holds `count` valid credential pointers until `CredFree`.
    unsafe {
        for &credential in std::slice::from_raw_parts(list, count as usize) {
            let credential = &*credential;
            if credential.Type != CRED_TYPE_GENERIC || credential.TargetName.is_null() {
                continue;
            }
            if let Some(key) = wide(credential.TargetName).strip_suffix(&suffix) {
                keys.push(key.to_owned());
            }
        }
        CredFree(list.cast());
    }

    Ok(keys)
}

/// A NUL-terminated UTF-16 string, lossily.
///
/// # Safety
///
/// `pointer` points at a NUL-terminated wide string.
#[expect(
    unsafe_code,
    reason = "reads a string the Credential Manager handed out"
)]
unsafe fn wide(pointer: *const u16) -> String {
    let mut length = 0;
    // SAFETY: the caller promises a terminator.
    while unsafe { *pointer.add(length) } != 0 {
        length += 1;
    }
    // SAFETY: `length` units were just read.
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two answers, and nothing between them.
    #[test]
    fn only_no_storage_access_is_read_as_an_absent_vault() {
        let absent = KeyringError::NoStorageAccess(Box::new(std::io::Error::other(
            "ERROR_NO_SUCH_LOGON_SESSION",
        )));

        assert!(absent_store(&absent).is_some_and(|advice| !advice.is_empty()));

        // A vault that is there and refused — the case the whole distinction exists for.
        let refused =
            KeyringError::PlatformFailure(Box::new(std::io::Error::other("ERROR_ACCESS_DENIED")));

        assert_eq!(absent_store(&refused), None);
        assert_eq!(absent_store(&KeyringError::NoEntry), None);
    }
}

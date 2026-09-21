//! What sync keeps between runs: one entry in the OS credential store, service `MixLab`, account
//! `sync-master-key` (the design's D2).
//!
//! **`MK`, the refresh token and a closed server's access token share it**, because on macOS every
//! item is one more question and all three are needed at the same moment. The rest — the server,
//! the address, the device id — is there so that signing in is one read.

use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::AppError;
use crate::secrets::{self, Redacted};

pub const ACCOUNT: &str = "sync-master-key";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub server: String,
    /// `X-MixLab-Access`, for a server somebody closed to their own people.
    pub access: Option<String>,
    pub email: String,
    pub device_id: String,
    pub refresh_token: String,
    /// `MK`, base64.
    pub master_key: String,
}

impl std::fmt::Debug for Saved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Saved")
            .field("server", &self.server)
            .field("access", &self.access.as_ref().map(|_| Redacted))
            .field("email", &self.email)
            .field("device_id", &self.device_id)
            .field("refresh_token", &Redacted)
            .field("master_key", &Redacted)
            .finish()
    }
}

fn unreadable() -> AppError {
    err!("error.syncSavedUnreadable")
}

impl Saved {
    pub fn master_key_bytes(&self) -> Result<[u8; 32], AppError> {
        STANDARD
            .decode(&self.master_key)
            .map_err(|_| unreadable())?
            .try_into()
            .map_err(|_| unreadable())
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn from_json(text: &str) -> Result<Self, AppError> {
        serde_json::from_str(text).map_err(|_| unreadable())
    }
}

/// Where a [`Saved`] lives between runs. Blocking: callers run it off the async thread.
pub trait Keeping: Send + Sync {
    fn load(&self) -> Result<Option<Saved>, AppError>;
    fn keep(&self, saved: &Saved) -> Result<(), AppError>;
    fn forget(&self) -> Result<(), AppError>;
}

/// The machine's own credential store.
pub struct CredentialStore;

impl Keeping for CredentialStore {
    fn load(&self) -> Result<Option<Saved>, AppError> {
        secrets::read_own(ACCOUNT)?
            .map(|text| Saved::from_json(&text))
            .transpose()
    }

    fn keep(&self, saved: &Saved) -> Result<(), AppError> {
        secrets::write_own(ACCOUNT, &saved.to_json())
    }

    fn forget(&self) -> Result<(), AppError> {
        secrets::forget_own(ACCOUNT)
    }
}

/// A store that lives as long as the value does — for tests, `tests/sync_live.rs` among them.
#[derive(Default)]
pub struct InMemory(Mutex<Option<Saved>>);

impl Keeping for InMemory {
    fn load(&self) -> Result<Option<Saved>, AppError> {
        Ok(self.0.lock().expect("never poisoned").clone())
    }

    fn keep(&self, saved: &Saved) -> Result<(), AppError> {
        *self.0.lock().expect("never poisoned") = Some(saved.clone());
        Ok(())
    }

    fn forget(&self) -> Result<(), AppError> {
        *self.0.lock().expect("never poisoned") = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved() -> Saved {
        Saved {
            server: "https://sync.example".into(),
            access: None,
            email: "a@example.invalid".into(),
            device_id: "d1".into(),
            refresh_token: "refresh-secret".into(),
            master_key: STANDARD.encode([7u8; 32]),
        }
    }

    #[test]
    fn what_is_kept_reads_back() {
        let keeping = InMemory::default();
        assert_eq!(keeping.load().unwrap(), None);
        keeping.keep(&saved()).unwrap();
        assert_eq!(keeping.load().unwrap(), Some(saved()));
        keeping.forget().unwrap();
        assert_eq!(keeping.load().unwrap(), None);
    }

    #[test]
    fn the_entry_is_one_json_object() {
        let text = saved().to_json();
        assert_eq!(Saved::from_json(&text).unwrap(), saved());
        assert!(Saved::from_json("not json").is_err());
    }

    #[test]
    fn a_debug_line_prints_no_secret() {
        let line = format!("{:?}", saved());
        assert!(line.contains("a@example.invalid"));
        assert!(!line.contains("refresh-secret"));
        assert!(!line.contains(&STANDARD.encode([7u8; 32])));
    }

    #[test]
    fn a_master_key_of_the_wrong_length_is_refused() {
        assert_eq!(saved().master_key_bytes().unwrap(), [7u8; 32]);
        let mut short = saved();
        short.master_key = STANDARD.encode([7u8; 31]);
        assert_eq!(
            short.master_key_bytes().unwrap_err().code,
            "error.syncSavedUnreadable"
        );
    }
}

//! Sending the two letters this server ever sends.
//!
//! **The provider sits behind this interface, and that is a more important decision than which
//! provider it is** (D8). Every free tier in this market will be renegotiated within a few years;
//! what protects a deployment is that changing provider is this file rather than a migration.
//!
//! The volume is two messages in the lifetime of an account — verify an address at registration,
//! prove control of it after a forgotten password — and nothing else.

use crate::config::Config;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LetterKind {
    Verification,
    Reset,
}

impl LetterKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Verification => "verification",
            Self::Reset => "reset",
        }
    }

    fn subject(self) -> &'static str {
        match self {
            Self::Verification => "Confirm your MixLab address",
            Self::Reset => "Reset your MixLab password",
        }
    }
}

fn body(kind: LetterKind, token: &str, verify_url: &str) -> String {
    match kind {
        LetterKind::Verification => format!(
            "Confirm this address to finish setting up your MixLab account:\n\n{verify_url}\n\n\
             The link works for 24 hours. If you did not ask for an account, ignore this message —\n\
             nothing was created that you have to undo.\n"
        ),
        LetterKind::Reset => format!(
            "Somebody asked to reset the password on this MixLab account. The code is:\n\n{token}\n\n\
             It works for one hour.\n\n\
             Resetting the password restores the login and NOT the data. Everything stored in the\n\
             account is encrypted with a key that only your password or your recovery key can\n\
             unwrap, and this server has never held either. Completing a reset deletes it all.\n\n\
             If you have your recovery key, close this message and use that instead — it keeps the\n\
             data.\n"
        ),
    }
}

/// Sends the letter, or returns the reason it could not be sent. **Loud on failure**, because the
/// alternative is a person waiting for a letter that was never sent.
pub async fn send(
    config: &Config,
    kind: LetterKind,
    to: &str,
    token: &str,
    verify_url: &str,
) -> Result<(), String> {
    let Some(key) = config.email_api_key.as_deref() else {
        return Err("no email provider is configured".to_owned());
    };

    let response = reqwest::Client::new()
        .post(&config.email_endpoint)
        .bearer_auth(key)
        .json(&serde_json::json!({
            "from": config.email_from,
            "to": [to],
            "subject": kind.subject(),
            "text": body(kind, token, verify_url),
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("the email provider answered {}", response.status()))
    }
}

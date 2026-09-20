//! Sending the two letters this server ever sends.
//!
//! **The provider sits behind this interface, and that is a more important decision than which
//! provider it is** (D8). Every free tier in this market will be renegotiated within a few years;
//! what protects a deployment is that changing provider is this file rather than a migration.
//!
//! The volume is two messages in the lifetime of an account — verify an address at registration,
//! prove control of it after a forgotten password — and nothing else.

use crate::config::Config;

/// **Two providers, because one does not prove anything.** D8 says the provider sits behind an
/// interface so that changing it is a file rather than a migration — a claim a single
/// implementation cannot test, in exactly the way `/v1` needs two servers to be a protocol.
///
/// They differ in more than a URL: the body shape and the header that carries the key are both
/// per-provider, which is the thing a "just change the endpoint" design gets wrong.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    /// `from` and `to` are plain strings; the key travels as a bearer token.
    Resend,
    /// `from` and `to` are objects; the key travels in `Api-Token`. The sandbox endpoint captures
    /// rather than delivers, which is what makes it usable for a live test.
    Mailtrap,
}

impl Provider {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "resend" => Some(Self::Resend),
            "mailtrap" => Some(Self::Mailtrap),
            _ => None,
        }
    }

    fn body(self, from: &str, to: &str, subject: &str, text: &str) -> serde_json::Value {
        match self {
            Self::Resend => serde_json::json!({
                "from": from, "to": [to], "subject": subject, "text": text,
            }),
            Self::Mailtrap => serde_json::json!({
                "from": { "email": from },
                "to": [{ "email": to }],
                "subject": subject,
                "text": text,
            }),
        }
    }
}

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

fn body(kind: LetterKind, code: &str) -> String {
    match kind {
        LetterKind::Verification => format!(
            "Type this code into MixLab to confirm your address:\n\n    {code}\n\n\
             It works for 24 hours. If you did not ask for an account, ignore this message —\n\
             nothing was created that you have to undo.\n"
        ),
        LetterKind::Reset => format!(
            "Somebody asked to reset the password on this MixLab account. The code is:\n\n    {code}\n\n\
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
pub async fn send(config: &Config, kind: LetterKind, to: &str, code: &str) -> Result<(), String> {
    let Some(key) = config.email_api_key.as_deref() else {
        return Err("no email provider is configured".to_owned());
    };

    let provider = config.email_provider;
    let payload = provider.body(&config.email_from, to, kind.subject(), &body(kind, code));

    let request = reqwest::Client::new().post(&config.email_endpoint);
    let request = match provider {
        Provider::Resend => request.bearer_auth(key),
        Provider::Mailtrap => request.header("Api-Token", key),
    };

    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        // The body, not just the status: a provider that refuses a message says why, and that
        // sentence is the difference between a minute and an afternoon.
        let detail = response.text().await.unwrap_or_default();
        Err(format!("the email provider answered {status}: {detail}"))
    }
}

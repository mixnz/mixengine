//! Sending the two letters this server ever sends.
//!
//! **The provider sits behind this interface, and that is a more important decision than which
//! provider it is** (D8). Every free tier in this market will be renegotiated within a few years;
//! what protects a deployment is that changing provider is this file rather than a migration.
//!
//! The volume is two messages in the lifetime of an account — verify an address at registration,
//! prove control of it after a forgotten password — and nothing else.
//!
//! **Seven providers, because one proves nothing.** The paragraph above is a claim, and a single
//! implementation cannot test it, in exactly the way `/v1` needs two servers before it is a
//! protocol rather than a description of one. These seven disagree about nearly everything a naive
//! interface would have assumed was fixed: **three ways of carrying the key** (a bearer token, a
//! header of the provider's own, HTTP basic auth), **two body encodings** (JSON and a form), and
//! **five different spellings of "who is this from"**. A design that only ever had to swap a URL
//! would have got all three wrong.
//!
//! **SMTP is here and not in `../worker/`**, and that is the one capability the two implementations
//! do not share: Workers cannot open a socket to port 587. It is also the provider most people
//! self-hosting already have, which is why the implementation somebody runs themselves is the one
//! that speaks it.

use crate::config::Config;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    /// A mail server the operator already has. Native only — Workers cannot speak SMTP.
    Smtp,
    /// `from` and `to` are plain strings; a bearer token.
    Resend,
    /// `from` and `to` are objects; the key rides in `Api-Token`. Only a sandbox endpoint carries
    /// an id; the transactional stream is the same for everybody.
    Mailtrap,
    /// `sender`, and the body is `textContent`; the key rides in `api-key`.
    Brevo,
    /// Capitalised members, and the key rides in `X-Postmark-Server-Token`.
    Postmark,
    /// Recipients live under `personalizations`, and the body is a list of typed parts.
    Sendgrid,
    /// **Form-encoded, not JSON**, and HTTP basic auth. The endpoint carries the sending domain.
    Mailgun,
}

impl Provider {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "smtp" => Some(Self::Smtp),
            "resend" => Some(Self::Resend),
            "mailtrap" => Some(Self::Mailtrap),
            "brevo" => Some(Self::Brevo),
            "postmark" => Some(Self::Postmark),
            "sendgrid" => Some(Self::Sendgrid),
            "mailgun" => Some(Self::Mailgun),
            _ => None,
        }
    }

    pub const NAMES: &'static str = "smtp, brevo, mailgun, mailtrap, postmark, resend, sendgrid";

    /// Where to post, when the endpoint is the same for everybody using that provider.
    ///
    /// Mailtrap's is its transactional stream, which is what the two letters are; only its sandbox
    /// URL carries an id, and a deployment testing against one sets it. Mailgun is `None` on
    /// purpose: its URL carries the sending domain and the region, so there is nothing to guess
    /// and a deployment that forgot it is told so before it starts rather than when the first
    /// letter fails to arrive.
    pub fn default_endpoint(self) -> Option<&'static str> {
        match self {
            Self::Smtp => None,
            Self::Resend => Some("https://api.resend.com/emails"),
            Self::Mailtrap => Some("https://send.api.mailtrap.io/api/send"),
            Self::Brevo => Some("https://api.brevo.com/v3/smtp/email"),
            Self::Postmark => Some("https://api.postmarkapp.com/email"),
            Self::Sendgrid => Some("https://api.sendgrid.com/v3/mail/send"),
            Self::Mailgun => None,
        }
    }

    pub fn needs_endpoint(self) -> bool {
        matches!(self, Self::Mailgun)
    }

    pub fn needs_api_key(self) -> bool {
        !matches!(self, Self::Smtp)
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
    let text = body(kind, code);
    match config.email_provider {
        Provider::Smtp => send_over_smtp(config, kind.subject(), to, &text).await,
        provider => send_over_http(config, provider, kind.subject(), to, &text).await,
    }
}

async fn send_over_http(
    config: &Config,
    provider: Provider,
    subject: &str,
    to: &str,
    text: &str,
) -> Result<(), String> {
    let key = config
        .email_api_key
        .as_deref()
        .ok_or("no email provider key is configured")?;
    let endpoint = config
        .email_endpoint
        .as_deref()
        .ok_or("no email endpoint is configured")?;
    let from = config.email_from.as_str();

    let request = reqwest::Client::new().post(endpoint);
    let request = match provider {
        Provider::Resend | Provider::Sendgrid => request.bearer_auth(key),
        Provider::Mailtrap => request.header("Api-Token", key),
        Provider::Brevo => request.header("api-key", key),
        Provider::Postmark => request.header("X-Postmark-Server-Token", key),
        // The one that does not carry a key in a header at all.
        Provider::Mailgun => request.basic_auth("api", Some(key)),
        Provider::Smtp => unreachable!("smtp does not take an HTTP request"),
    };

    let request = match provider {
        Provider::Resend => request.json(&serde_json::json!({
            "from": from, "to": [to], "subject": subject, "text": text,
        })),
        Provider::Mailtrap => request.json(&serde_json::json!({
            "from": { "email": from }, "to": [{ "email": to }],
            "subject": subject, "text": text,
        })),
        Provider::Brevo => request.json(&serde_json::json!({
            "sender": { "email": from }, "to": [{ "email": to }],
            "subject": subject, "textContent": text,
        })),
        Provider::Postmark => request.json(&serde_json::json!({
            "From": from, "To": to, "Subject": subject, "TextBody": text,
        })),
        Provider::Sendgrid => request.json(&serde_json::json!({
            "personalizations": [{ "to": [{ "email": to }] }],
            "from": { "email": from },
            "subject": subject,
            "content": [{ "type": "text/plain", "value": text }],
        })),
        // Form-encoded, which is why the body shape is a per-provider decision and not one field.
        Provider::Mailgun => request.form(&[
            ("from", from),
            ("to", to),
            ("subject", subject),
            ("text", text),
        ]),
        Provider::Smtp => unreachable!("smtp does not take an HTTP request"),
    };

    let response = request.send().await.map_err(|error| error.to_string())?;
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

async fn send_over_smtp(
    config: &Config,
    subject: &str,
    to: &str,
    text: &str,
) -> Result<(), String> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

    let smtp = config.smtp.as_ref().ok_or("no SMTP host is configured")?;

    let message = Message::builder()
        .from(config.email_from.parse().map_err(|_| {
            format!(
                "MIXLAB_SYNC_EMAIL_FROM is not an address SMTP will take: {}",
                config.email_from
            )
        })?)
        .to(to
            .parse()
            .map_err(|_| format!("that is not an address SMTP will take: {to}"))?)
        .subject(subject)
        .body(text.to_owned())
        .map_err(|error| error.to_string())?;

    let builder = match smtp.tls {
        Tls::Implicit => AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp.host),
        Tls::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp.host),
        // For a mail server on the same machine or the same private network, where there is no
        // certificate to check and nothing crossing anything. Never across the internet.
        Tls::None => Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
            &smtp.host,
        )),
    }
    .map_err(|error| error.to_string())?;

    let builder = builder.port(smtp.port);
    let builder = match (&smtp.username, &smtp.password) {
        (Some(username), Some(password)) => {
            builder.credentials(Credentials::new(username.clone(), password.clone()))
        }
        _ => builder,
    };

    builder
        .build()
        .send(message)
        .await
        .map(|_| ())
        .map_err(|error| format!("the mail server refused the message: {error}"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tls {
    /// TLS from the first byte, which is port 465.
    Implicit,
    /// Plain, then upgraded, which is port 587 and what most providers want.
    StartTls,
    /// No TLS at all: a mail server on this machine or this private network, and nowhere else.
    None,
}

impl Tls {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "implicit" | "tls" | "smtps" => Some(Self::Implicit),
            "starttls" => Some(Self::StartTls),
            "none" | "plain" => Some(Self::None),
            _ => None,
        }
    }

    pub fn default_port(self) -> u16 {
        match self {
            Self::Implicit => 465,
            Self::StartTls => 587,
            Self::None => 25,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Smtp {
    pub host: String,
    pub port: u16,
    pub tls: Tls,
    pub username: Option<String>,
    pub password: Option<String>,
}

//! What this deployment was configured with, and what it refuses to start without.
//!
//! **A server missing a piece of its configuration refuses to start, and names the piece** (D8).
//! Unlike the Worker, which has no startup and answers `503` to every request instead, this one
//! can genuinely refuse: it exits before it binds a port. The failure it replaces is otherwise
//! invisible — the process starts, registration succeeds, and a person waits for a letter that was
//! never sent.

use serde::Serialize;

/// Everything reported by `/v1/capabilities`. Every number is configuration and not protocol: a
/// server may report any value, and a client reads rather than assumes (D4a, D9).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub protocol_versions: Vec<String>,
    pub max_record_bytes: u64,
    pub max_batch_operations: u64,
    pub max_page_records: u64,
    pub account_quota_bytes: u64,
    pub tombstone_retention_days: u64,
    /// A complete v1 server announces nothing optional, and a client must run against an empty
    /// list forever (D4a).
    pub features: Vec<String>,
}

/// The allowances that are deliberately **not** in `Capabilities`: publishing the number that
/// stops abuse helps only the abuser (D4a).
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub registrations_per_hour: u64,
    pub resets_per_hour: u64,
    pub logins_per_window: u64,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub database: String,
    pub pepper: String,
    pub email_api_key: Option<String>,
    pub email_from: String,
    pub email_endpoint: String,
    pub public_url: String,
    /// Serves `/__test__/outbox` and sends no mail. Never set on a real deployment.
    pub test_outbox: bool,
    pub limits: Limits,
    pub capabilities: Capabilities,
}

/// A fixed pepper for a server started in test-outbox mode. Constant on purpose: that mode already
/// hands out verification tokens over HTTP, so there is nothing left for a secret to protect, and
/// requiring one would only make the suite harder to run.
const TEST_PEPPER: &str = "conformance-pepper-not-for-any-real-deployment";

fn number(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(fallback)
}

fn text(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

impl Config {
    /// Reads the environment, or returns the names of what is missing. The caller prints them and
    /// exits: a list is more useful than the first failure, because setting one at a time and
    /// restarting is the slow way to find out you needed three.
    pub fn from_env() -> Result<Self, Vec<&'static str>> {
        let test_outbox = std::env::var("MIXLAB_SYNC_TEST_OUTBOX").as_deref() == Ok("1");

        let mut missing = Vec::new();
        let pepper = text("MIXLAB_SYNC_PEPPER");
        let email_api_key = text("MIXLAB_SYNC_EMAIL_API_KEY");
        let email_from = text("MIXLAB_SYNC_EMAIL_FROM");

        if !test_outbox {
            if pepper.is_none() {
                missing.push("MIXLAB_SYNC_PEPPER");
            }
            if email_api_key.is_none() {
                missing.push("MIXLAB_SYNC_EMAIL_API_KEY");
            }
            if email_from.is_none() {
                missing.push("MIXLAB_SYNC_EMAIL_FROM");
            }
        }
        if !missing.is_empty() {
            return Err(missing);
        }

        let bind = text("MIXLAB_SYNC_BIND").unwrap_or_else(|| "127.0.0.1:8080".to_owned());
        Ok(Self {
            public_url: text("MIXLAB_SYNC_PUBLIC_URL").unwrap_or_else(|| format!("http://{bind}")),
            bind,
            database: text("MIXLAB_SYNC_DATABASE").unwrap_or_else(|| "mixlab-sync.db".to_owned()),
            pepper: pepper.unwrap_or_else(|| TEST_PEPPER.to_owned()),
            email_api_key,
            email_from: email_from.unwrap_or_else(|| "conformance@example.invalid".to_owned()),
            email_endpoint: text("MIXLAB_SYNC_EMAIL_ENDPOINT")
                .unwrap_or_else(|| "https://api.resend.com/emails".to_owned()),
            test_outbox,
            limits: Limits {
                registrations_per_hour: number("MIXLAB_SYNC_REGISTRATIONS_PER_HOUR", 10),
                resets_per_hour: number("MIXLAB_SYNC_RESETS_PER_HOUR", 10),
                logins_per_window: number("MIXLAB_SYNC_LOGINS_PER_WINDOW", 20),
            },
            capabilities: Capabilities {
                protocol_versions: vec!["v1".to_owned()],
                max_record_bytes: number("MIXLAB_SYNC_MAX_RECORD_BYTES", 1_048_576),
                max_batch_operations: number("MIXLAB_SYNC_MAX_BATCH_OPERATIONS", 100),
                max_page_records: number("MIXLAB_SYNC_MAX_PAGE_RECORDS", 500),
                account_quota_bytes: number("MIXLAB_SYNC_ACCOUNT_QUOTA_BYTES", 20_971_520),
                tombstone_retention_days: number("MIXLAB_SYNC_TOMBSTONE_RETENTION_DAYS", 90),
                features: Vec::new(),
            },
        })
    }
}

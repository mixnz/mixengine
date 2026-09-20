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
    pub max_batch_bytes: u64,
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
    /// How often one source may ask where an address's salt is. Generous: a company behind
    /// one address may install on fifty machines in a morning.
    pub params_per_hour: u64,
    /// How often one source may try to sign in or spend a code, across every account. The
    /// per-account counters cannot see somebody working through a list of addresses.
    pub auth_per_hour: u64,
    /// Eight characters are only safe because this one is real (D4a).
    pub verify_attempts_per_window: u64,
}

#[derive(Clone, Debug)]
pub struct Config {
    /// Which endpoint a retired account is sent to (D4b). A symbolic id, never a URL.
    pub relocate_to: Option<String>,
    /// How long a freeze lasts before it lapses.
    pub relocation_lease_seconds: i64,
    pub bind: String,
    pub database: String,
    pub pepper: String,
    pub email_api_key: Option<String>,
    pub email_from: String,
    /// `None` for SMTP, and for a provider whose URL carries something only the operator
    /// knows — an inbox id, a sending domain.
    pub email_endpoint: Option<String>,
    pub email_provider: crate::email::Provider,
    pub smtp: Option<crate::email::Smtp>,
    /// Serves `/__test__/outbox` and sends no mail. Never set on a real deployment.
    /// A shared token that closes this deployment to everybody who has not been given it.
    /// `None` means open, which is what the hosted instances are.
    pub access_token: Option<String>,
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
    pub fn from_env() -> Result<Self, Vec<String>> {
        let test_outbox = std::env::var("MIXLAB_SYNC_TEST_OUTBOX").as_deref() == Ok("1");

        let mut missing: Vec<String> = Vec::new();
        let pepper = text("MIXLAB_SYNC_PEPPER");
        let email_api_key = text("MIXLAB_SYNC_EMAIL_API_KEY");
        let email_from = text("MIXLAB_SYNC_EMAIL_FROM");

        if !test_outbox {
            if pepper.is_none() {
                missing.push("MIXLAB_SYNC_PEPPER".to_owned());
            }
            if email_from.is_none() {
                missing.push("MIXLAB_SYNC_EMAIL_FROM".to_owned());
            }
        }
        // **No default.** An API key on its own does not say where to send it, and guessing meant
        // somebody pasting a SendGrid key and nothing else had it posted to Resend — which fails,
        // correctly but confusingly, at the first letter rather than at the first start.
        let provider_name = text("MIXLAB_SYNC_EMAIL_PROVIDER");
        let email_provider = provider_name
            .as_deref()
            .and_then(crate::email::Provider::parse);
        // A name nobody implements is a piece of configuration that is missing rather than wrong:
        // the deploy would otherwise succeed and the first letter would be the thing that failed.
        if !test_outbox && email_provider.is_none() {
            missing.push(format!(
                "MIXLAB_SYNC_EMAIL_PROVIDER (one of: {})",
                crate::email::Provider::NAMES
            ));
        }

        let endpoint = text("MIXLAB_SYNC_EMAIL_ENDPOINT")
            .or_else(|| email_provider.and_then(|p| p.default_endpoint().map(str::to_owned)));
        let smtp_host = text("MIXLAB_SYNC_SMTP_HOST");
        let tls_name = text("MIXLAB_SYNC_SMTP_TLS").unwrap_or_else(|| "starttls".into());
        let tls = crate::email::Tls::parse(&tls_name);

        // **What is needed depends on which provider was named**, so this asks the provider rather
        // than demanding everything from everybody.
        if !test_outbox && let Some(provider) = email_provider {
            if provider.needs_api_key() && email_api_key.is_none() {
                missing.push("MIXLAB_SYNC_EMAIL_API_KEY".to_owned());
            }
            // Mailtrap's URL carries an inbox id and Mailgun's a sending domain: there is nothing
            // to guess, so a deployment that forgot one is told before it starts.
            if provider.needs_endpoint() && endpoint.is_none() {
                missing.push("MIXLAB_SYNC_EMAIL_ENDPOINT".to_owned());
            }
            if provider == crate::email::Provider::Smtp {
                if smtp_host.is_none() {
                    missing.push("MIXLAB_SYNC_SMTP_HOST".to_owned());
                }
                if tls.is_none() {
                    missing
                        .push("MIXLAB_SYNC_SMTP_TLS (one of: starttls, implicit, none)".to_owned());
                }
            }
        }

        if !missing.is_empty() {
            return Err(missing);
        }

        // **Not 8080.** The machine most likely to run this is somebody's own, and on a MixLab
        // machine 8080 is already taken: MixEngine's front end binds it to answer on 80 without
        // privileges (`crates/mixengine-core/src/generate/recipes/caddy.rs`). A default that
        // collides with the product it belongs to is a default that is wrong for its own audience.
        // 8765 is not claimed anywhere in this repository; any port is still the operator's to set.
        let bind = text("MIXLAB_SYNC_BIND").unwrap_or_else(|| "127.0.0.1:8765".to_owned());
        Ok(Self {
            bind,
            database: text("MIXLAB_SYNC_DATABASE").unwrap_or_else(|| "mixlab-sync.db".to_owned()),
            pepper: pepper.unwrap_or_else(|| TEST_PEPPER.to_owned()),
            email_api_key,
            email_from: email_from.unwrap_or_else(|| "conformance@example.invalid".to_owned()),
            email_endpoint: endpoint,
            email_provider: email_provider.unwrap_or(crate::email::Provider::Resend),
            smtp: smtp_host.map(|host| {
                let tls = tls.unwrap_or(crate::email::Tls::StartTls);
                crate::email::Smtp {
                    host,
                    port: number("MIXLAB_SYNC_SMTP_PORT", u64::from(tls.default_port())) as u16,
                    tls,
                    username: text("MIXLAB_SYNC_SMTP_USERNAME"),
                    password: text("MIXLAB_SYNC_SMTP_PASSWORD"),
                }
            }),
            access_token: text("MIXLAB_SYNC_ACCESS_TOKEN"),
            test_outbox,
            relocate_to: text("MIXLAB_SYNC_RELOCATE_TO"),
            relocation_lease_seconds: number("MIXLAB_SYNC_RELOCATION_LEASE_SECONDS", 900) as i64,
            limits: Limits {
                registrations_per_hour: number("MIXLAB_SYNC_REGISTRATIONS_PER_HOUR", 10),
                resets_per_hour: number("MIXLAB_SYNC_RESETS_PER_HOUR", 10),
                logins_per_window: number("MIXLAB_SYNC_LOGINS_PER_WINDOW", 20),
                params_per_hour: number("MIXLAB_SYNC_PARAMS_PER_HOUR", 200),
                auth_per_hour: number("MIXLAB_SYNC_AUTH_PER_HOUR", 300),
                verify_attempts_per_window: number("MIXLAB_SYNC_VERIFY_ATTEMPTS_PER_WINDOW", 10),
            },
            capabilities: Capabilities {
                protocol_versions: vec!["v1".to_owned()],
                max_record_bytes: number("MIXLAB_SYNC_MAX_RECORD_BYTES", 1_048_576),
                max_batch_operations: number("MIXLAB_SYNC_MAX_BATCH_OPERATIONS", 100),
                max_batch_bytes: number("MIXLAB_SYNC_MAX_BATCH_BYTES", 8_388_608),
                max_page_records: number("MIXLAB_SYNC_MAX_PAGE_RECORDS", 500),
                account_quota_bytes: number("MIXLAB_SYNC_ACCOUNT_QUOTA_BYTES", 20_971_520),
                tombstone_retention_days: number("MIXLAB_SYNC_TOMBSTONE_RETENTION_DAYS", 90),
                features: Vec::new(),
            },
        })
    }
}

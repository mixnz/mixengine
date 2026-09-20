//! MixLab's sync server over a SQLite file — the implementation somebody runs themselves.
//!
//! **This exists so that `/v1` is a protocol rather than a description of one codebase.** The
//! Worker in `../worker/` is the default instance; this speaks the same protocol over different
//! machinery, and `../conformance/` is written against the document both answer to rather than
//! against either of them. Each implementation is the other's proof, and the suite is what makes
//! that claim checkable rather than asserted.
//!
//! The contract is normative in `docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md`,
//! D2 to D4a. When this disagrees with that document, this is the one with the bug.
//!
//! **Nothing here parses a ciphertext.** What the server necessarily sees is listed in full in D1.
//!
//! # Why this is a library with a binary on top
//!
//! The binary is a `main` that reads the environment and serves [`router`]. Everything else is
//! here, which keeps it reachable from a test in this crate without a port and a process.

pub mod accounts;
pub mod config;
pub mod crypto;
pub mod db;
pub mod devices;
pub mod email;
pub mod http;
pub mod reaper;
pub mod records;
pub mod recovery;
pub mod relocation;
pub mod validate;

use std::sync::Arc;

use axum::Router;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use config::Config;
use db::Db;
use rusqlite::params;
use serde_json::json;

pub struct AppState {
    pub config: Config,
    pub db: Arc<Db>,
}

/// Every route this server answers. Taking a [`Config`] rather than reading the environment is
/// what lets a test run two of these with different limits in one process.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/auth/params", get(accounts::params))
        .route("/v1/auth/register", post(accounts::register))
        // **There is no GET here.** The letter carries a code the person types, not a link they
        // click (D4a), so there is no page to serve and no public address to get wrong.
        .route("/v1/auth/verify", post(accounts::verify))
        .route("/v1/auth/login", post(accounts::login))
        .route("/v1/auth/refresh", post(accounts::refresh))
        .route("/v1/auth/password", post(recovery::change_password))
        .route("/v1/auth/reset", post(recovery::reset))
        .route("/v1/devices", get(devices::list))
        .route("/v1/devices/{id}", delete(devices::remove))
        .route(
            "/v1/account/relocation",
            get(relocation::read).post(relocation::set),
        )
        .route("/v1/records", get(records::list))
        .route("/v1/records/batch", post(records::batch))
        .route(
            "/v1/records/{collection}/{id}",
            put(records::write).delete(records::write),
        )
        .route("/__test__/outbox", get(outbox))
        // An unknown route answers in the one error shape like everything else, rather than with
        // the bare 404 a framework gives for free (D4a).
        .fallback(async || http::not_found())
        .with_state(state)
}

/// Answered from configuration, without touching the database and without an account: a client
/// reads this before it has one (D4a).
async fn capabilities(State(state): State<Arc<AppState>>) -> Response {
    (
        [(axum::http::header::CACHE_CONTROL, "public, max-age=3600")],
        axum::Json(state.config.capabilities.clone()),
    )
        .into_response()
}

#[derive(serde::Deserialize)]
struct Link {
    email: Option<String>,
}

/// Verification arrives by email, which no HTTP suite can read, so a server under test hands the
/// tokens back here — **and answers `404` unless it was started with that mode deliberately**. It
/// is outside `/v1` so the frozen surface stays frozen and a deployed server cannot be asked
/// for it.
async fn outbox(State(state): State<Arc<AppState>>, Query(link): Query<Link>) -> Response {
    if !state.config.test_outbox {
        return http::not_found().into_response();
    }
    let Some(email) = link.email.filter(|email| validate::is_email(email)) else {
        return http::not_found().into_response();
    };
    let key = crypto::account_key(&email);

    let messages = state
        .db
        .call(move |connection| {
            let mut statement = connection.prepare(
                "SELECT o.kind, o.token, o.sent_at FROM outbox o
                 JOIN account a ON a.id = o.account_id
                 WHERE a.account_key = ?1 ORDER BY o.id ASC",
            )?;
            statement
                .query_map(params![key], |row| {
                    Ok(json!({
                        "kind": row.get::<_, String>(0)?,
                        "token": row.get::<_, String>(1)?,
                        "sentAt": row.get::<_, i64>(2)?,
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .await;

    match messages {
        Ok(messages) => axum::Json(json!({ "messages": messages })).into_response(),
        Err(error) => {
            tracing::error!("database error: {error}");
            http::not_found().into_response()
        }
    }
}

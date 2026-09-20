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
//! here, which keeps it reachable from a test in this crate without a port and a process — and,
//! incidentally, stops `-D warnings` from rejecting a module whose callers land in a later commit.

pub mod config;
pub mod http;

use axum::Router;
use axum::routing::get;
use config::Config;

/// Every route this server answers. Taking a [`Config`] rather than reading the environment is
/// what lets a test run two of these with different limits in one process.
pub fn router(config: Config) -> Router {
    Router::new()
        .route("/v1/capabilities", get(capabilities))
        // An unknown route answers in the one error shape like everything else, rather than with
        // the bare 404 a framework gives for free (D4a).
        .fallback(async || http::not_found())
        .with_state(config)
}

/// Answered from configuration, without touching the database and without an account: a client
/// reads this before it has one (D4a).
async fn capabilities(
    axum::extract::State(config): axum::extract::State<Config>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    (
        [(axum::http::header::CACHE_CONTROL, "public, max-age=3600")],
        axum::Json(config.capabilities.clone()),
    )
        .into_response()
}

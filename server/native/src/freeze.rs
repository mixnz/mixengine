//! Holding an account still while a client copies it somewhere else (D4b).
//!
//! **The client copies; this server is only asked to hold still.** Nothing here exports anything
//! and nothing enumerates accounts. The machine that already holds the data carries it across, and
//! this is the vocabulary it uses to say *"hold still"* and then *"I am done"*.
//!
//! Where the copy is going is not this server's business and is never told to it: the destination
//! is an address a person typed into MixLab.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::AppState;
use crate::accounts::{authenticate, parse};
use crate::crypto::now;
use crate::http::{Failure, invalid_request, invalid_token};

/// The freeze guard, asked by a mutating handler before it does its own work.
///
/// It costs one extra query and buys a check written once instead of threaded through every
/// handler's result type. `None` also covers an unauthenticated request: the handler behind this
/// is about to answer `401` on its own.
pub async fn guard(state: &Arc<AppState>, headers: &HeaderMap) -> Option<Failure> {
    let headers = headers.clone();
    state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(None);
            };
            blocked(connection, session.account_id)
        })
        .await
        // **Closed, not open.** A database error here reading as "nothing is blocking this
        // request" would let a write through on an account that is being copied — the one state
        // whose whole purpose is to stop exactly that.
        .unwrap_or_else(|error| {
            tracing::error!("could not read the freeze state: {error}");
            Some(Failure::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server-error",
                "Something went wrong on the server.",
            ))
        })
}

pub struct Where {
    pub state: String,
    pub frozen_at: Option<i64>,
}

impl Where {
    fn body(&self) -> Value {
        json!({ "state": self.state, "frozenAt": self.frozen_at })
    }
}

/// **A freeze ends when a client ends it, and not before.** There is no expiry: asking for
/// `active` is reachable from every signed-in machine, and reading and signing in both work while
/// frozen, so a copy cut off by a dead machine is one request away from over. A timeout would
/// instead let a copy that finished and was never followed up reopen this server on a clock, for
/// a machine nobody repointed to write into (D4b).
pub fn effective(connection: &Connection, account_id: i64) -> rusqlite::Result<Where> {
    let row: Option<(String, Option<i64>)> = connection
        .query_row(
            "SELECT freeze_state, freeze_at FROM account WHERE id = ?1",
            params![account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    Ok(match row {
        Some((state, at)) => Where {
            state,
            frozen_at: at,
        },
        None => Where {
            state: "active".to_owned(),
            frozen_at: None,
        },
    })
}

/// What every mutating route owes an account that is being copied. Reads are not asked: the
/// machine doing the copying needs them, and so does a second machine deciding whether to take the
/// copy over.
pub fn blocked(connection: &Connection, account_id: i64) -> rusqlite::Result<Option<Failure>> {
    if effective(connection, account_id)?.state != "frozen" {
        return Ok(None);
    }
    Ok(Some(Failure::new(
        StatusCode::LOCKED,
        "account-frozen",
        "This account is being moved to another server and can't be changed right now.",
    )))
}

fn server_error(error: impl std::fmt::Display) -> Response {
    tracing::error!("database error: {error}");
    Failure::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server-error",
        "Something went wrong on the server.",
    )
    .into_response()
}

/// Answered in both states: a machine that meets a refusal has to be able to find out why, and
/// decide whether to continue the copy or abandon it.
pub async fn read(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(None);
            };
            effective(connection, session.account_id).map(Some)
        })
        .await;

    match outcome {
        Err(error) => server_error(error),
        Ok(None) => invalid_token().into_response(),
        Ok(Some(current)) => Json(current.body()).into_response(),
    }
}

pub async fn set(State(state): State<Arc<AppState>>, headers: HeaderMap, body: String) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };
    let wanted = match fields.get("state").and_then(Value::as_str) {
        Some(wanted @ ("active" | "frozen")) => wanted.to_owned(),
        _ => return invalid_request("`state` must be active or frozen.").into_response(),
    };

    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(Err(invalid_token()));
            };
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let account_id = session.account_id;

            if wanted == "active" {
                // **Thawing is the only way out.** This is how the client that finished copying
                // ends the freeze, and how one that gave up abandons it.
                transaction.execute(
                    "UPDATE account SET freeze_state = 'active', freeze_at = NULL WHERE id = ?1",
                    params![account_id],
                )?;
            } else {
                // Idempotent, and the clock does not restart: `freeze_at` is when this began,
                // which is what a client shows somebody being told their account has been
                // read-only for a while.
                transaction.execute(
                    "UPDATE account SET freeze_state = 'frozen',
                                        freeze_at = COALESCE(freeze_at, ?2)
                     WHERE id = ?1",
                    params![account_id, now()],
                )?;
            }

            let settled = effective(&transaction, account_id)?;
            transaction.commit()?;
            Ok(Ok(settled))
        })
        .await;

    match outcome {
        Err(error) => server_error(error),
        Ok(Err(failure)) => failure.into_response(),
        Ok(Ok(current)) => Json(current.body()).into_response(),
    }
}

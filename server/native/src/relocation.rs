//! Moving an account to another server (D4b).
//!
//! **The client does the moving; this server is told.** Nothing here exports anything and nothing
//! enumerates accounts. The machine that already holds the data carries it across, and this is the
//! vocabulary it uses to say *"hold still"* and then *"I am done, you can point people at the other
//! one"*.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::AppState;
use crate::accounts::{authenticate, parse};
use crate::config::Config;
use crate::crypto::now;
use crate::http::{Failure, invalid_request, invalid_token};

/// The relocation guard, asked before a handler does its own work.
///
/// It costs one extra query, and it buys a check that is written once instead of threaded through
/// every handler's result type. `None` also covers an unauthenticated request: the handler behind
/// this is about to answer `401` on its own, and a moved account owes a stranger nothing.
pub async fn guard(state: &Arc<AppState>, headers: &HeaderMap, mutating: bool) -> Option<Failure> {
    let config = state.config.clone();
    let headers = headers.clone();
    state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(None);
            };
            blocked(connection, &config, session.account_id, mutating)
        })
        .await
        // **Closed, not open.** A database error here used to read as "nothing is blocking this
        // request", which would let a write through on an account that is frozen or has moved —
        // the two states whose whole purpose is to stop exactly that.
        .unwrap_or_else(|error| {
            tracing::error!("could not read the relocation state: {error}");
            Some(Failure::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server-error",
                "Something went wrong here.",
            ))
        })
}

pub struct Where {
    pub state: String,
    pub home: Option<String>,
    pub frozen_until: Option<i64>,
}

impl Where {
    fn body(&self) -> Value {
        json!({
            "state": self.state,
            "home": self.home,
            "frozenUntil": self.frozen_until,
        })
    }
}

/// The effective state, which is not always the stored one: **a freeze is a lease**. Once it lapses
/// the account is active again, so a copy interrupted by a dead network, a dead machine or somebody
/// who changed their mind repairs itself — rather than leaving an account nobody can write to and
/// nobody but an operator can rescue.
pub fn effective(
    connection: &Connection,
    config: &Config,
    account_id: i64,
) -> rusqlite::Result<Where> {
    let row: Option<(String, Option<i64>, Option<String>)> = connection
        .query_row(
            "SELECT relocation_state, relocation_until, relocation_home FROM account WHERE id = ?1",
            params![account_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let Some((state, until, home)) = row else {
        return Ok(Where {
            state: "active".to_owned(),
            home: config.relocate_to.clone(),
            frozen_until: None,
        });
    };

    if state == "frozen" && until.unwrap_or(0) <= now() {
        connection.execute(
            "UPDATE account SET relocation_state = 'active', relocation_until = NULL WHERE id = ?1",
            params![account_id],
        )?;
        return Ok(Where {
            state: "active".to_owned(),
            home: config.relocate_to.clone(),
            frozen_until: None,
        });
    }

    Ok(Where {
        state,
        home: home.or_else(|| config.relocate_to.clone()),
        frozen_until: until,
    })
}

fn moved(home: Option<String>) -> Failure {
    Failure::new(
        // **Not 421**, which reads better and was tried first: RFC 9110 lets a client retry one on
        // a different connection, and real clients do — the retry finds the body already sent and
        // fails with a content-length mismatch instead of surfacing this answer. Retirement is
        // permanent, which is what 410 says, and the code is what a client switches on anyway.
        StatusCode::GONE,
        "account-moved",
        "This account lives on another server now.",
    )
    .with("home", json!(home))
}

/// What every route owes a moved or frozen account, before it does anything else.
pub fn blocked(
    connection: &Connection,
    config: &Config,
    account_id: i64,
    mutating: bool,
) -> rusqlite::Result<Option<Failure>> {
    let current = effective(connection, config, account_id)?;
    if current.state == "retired" {
        return Ok(Some(moved(current.home)));
    }
    if mutating && current.state == "frozen" {
        return Ok(Some(Failure::new(
            StatusCode::LOCKED,
            "account-frozen",
            "This account is being moved and cannot change.",
        )));
    }
    Ok(None)
}

fn server_error(error: impl std::fmt::Display) -> Response {
    tracing::error!("database error: {error}");
    Failure::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server-error",
        "Something went wrong here.",
    )
    .into_response()
}

/// Answered in every state, `retired` included: a machine that meets a refusal has to be able to
/// find out why, and where to go instead.
pub async fn read(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let config = state.config.clone();
    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(None);
            };
            effective(connection, &config, session.account_id).map(Some)
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
        Some(wanted @ ("active" | "frozen" | "retired")) => wanted.to_owned(),
        _ => return invalid_request("`state` is active, frozen or retired.").into_response(),
    };

    let config = state.config.clone();
    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(Err(invalid_token()));
            };
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let account_id = session.account_id;
            let current = effective(&transaction, &config, account_id)?;

            if current.state == "retired" {
                transaction.commit()?;
                return Ok(Err(moved(current.home)));
            }

            match wanted.as_str() {
                "active" => {
                    transaction.execute(
                        "UPDATE account SET relocation_state = 'active', relocation_until = NULL
                         WHERE id = ?1",
                        params![account_id],
                    )?;
                }
                "frozen" => {
                    // Idempotent, and re-arming is how a client that is still copying keeps the
                    // lease alive.
                    transaction.execute(
                        "UPDATE account SET relocation_state = 'frozen', relocation_until = ?2
                         WHERE id = ?1",
                        params![account_id, now() + config.relocation_lease_seconds],
                    )?;
                }
                _ => {
                    // **Freeze first.** Retiring straight from active would leave a window in which
                    // a second machine writes something the copy never saw, and two servers cannot
                    // be reconciled afterwards — their sequence numbers are independent.
                    if current.state != "frozen" {
                        transaction.commit()?;
                        return Ok(Err(Failure::new(
                            StatusCode::CONFLICT,
                            "must-freeze-first",
                            "Freeze the account before retiring it.",
                        )));
                    }
                    let Some(home) = config.relocate_to.clone() else {
                        transaction.commit()?;
                        return Ok(Err(Failure::new(
                            StatusCode::CONFLICT,
                            "relocation-not-configured",
                            "This server has nowhere to send the account, so it will not let go \
                             of it.",
                        )));
                    };
                    transaction.execute(
                        "DELETE FROM record WHERE account_id = ?1",
                        params![account_id],
                    )?;
                    transaction.execute(
                        "UPDATE account SET relocation_state = 'retired', relocation_until = NULL,
                                            relocation_home = ?2, stored_bytes = 0
                         WHERE id = ?1",
                        params![account_id, home],
                    )?;
                }
            }

            let settled = effective(&transaction, &config, account_id)?;
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

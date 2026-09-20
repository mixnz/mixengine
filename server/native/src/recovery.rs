//! Losing the password: changing it while signed in, and the reset that abandons the data (D6).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

use crate::AppState;
use crate::accounts::{authenticate, bad_code, parse};
use crate::crypto::{normalise_code, now, peppered, random_code, same_secret, sha256_hex};
use crate::email::LetterKind;
use crate::http::{Failure, invalid_request, invalid_token};
use crate::validate::{is_base64, is_email};

const RESET_TOKEN_SECONDS: i64 = 60 * 60;
const SOURCE_WINDOW_SECONDS: i64 = 60 * 60;

fn field<'a>(fields: &'a Value, name: &str) -> Option<&'a str> {
    fields
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| is_base64(value, None))
}

fn server_error(error: impl std::fmt::Display) -> Failure {
    tracing::error!("database error: {error}");
    Failure::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server-error",
        "Something went wrong here.",
    )
}

/// D6, case 1: re-wrap, one request, nothing else moves.
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };
    let (Some(a), Some(new_a), Some(new_salt), Some(new_wrapped)) = (
        field(&fields, "a"),
        field(&fields, "newA"),
        field(&fields, "newSaltAccount"),
        field(&fields, "newWrappedMkPassword"),
    ) else {
        return invalid_request("The current verifier, and the new one with its salt.")
            .into_response();
    };

    let presented = peppered(&state.config.pepper, a);
    let replacement = peppered(&state.config.pepper, new_a);
    let (new_salt, new_wrapped) = (new_salt.to_owned(), new_wrapped.to_owned());

    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(Err(invalid_token()));
            };
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let stored: Option<String> = transaction
                .query_row(
                    "SELECT verifier FROM account WHERE id = ?1",
                    params![session.account_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(stored) = stored.filter(|stored| same_secret(stored, &presented)) else {
                transaction.commit()?;
                return Ok(Err(Failure::new(
                    StatusCode::UNAUTHORIZED,
                    "invalid-credentials",
                    "That password does not match this account.",
                )));
            };
            let _ = stored;

            // **MK is unchanged**, so nothing is re-encrypted and no record and no sequence number
            // moves (D6, case 1). A server that bumped `seq` here would make every other machine
            // re-download the whole account for a change it cannot see.
            transaction.execute(
                "UPDATE account SET verifier = ?1, salt_account = ?2, wrapped_mk_password = ?3
                 WHERE id = ?4",
                params![replacement, new_salt, new_wrapped, session.account_id],
            )?;
            // Every other machine is signed out: the password they hold no longer unwraps anything.
            transaction.execute(
                "DELETE FROM token WHERE account_id = ?1 AND device_id != ?2",
                params![session.account_id, session.device_id],
            )?;
            transaction.commit()?;
            Ok(Ok(()))
        })
        .await;

    match outcome {
        Err(error) => server_error(error).into_response(),
        Ok(Err(failure)) => failure.into_response(),
        Ok(Ok(())) => Json(json!({})).into_response(),
    }
}

/// One path, two shapes (D4a), told apart by whether `token` is present: ask for the letter, then
/// complete with what it carried.
pub async fn reset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };
    let Some(email) = fields
        .get("email")
        .and_then(Value::as_str)
        .filter(|value| is_email(value))
    else {
        return invalid_request("An address is required.").into_response();
    };
    let email = email.trim().to_lowercase();

    match fields.get("token").and_then(Value::as_str) {
        None => ask(state, headers, email).await,
        Some(token) => complete(state, fields.clone(), email, token.to_owned()).await,
    }
}

async fn ask(state: Arc<AppState>, headers: HeaderMap, email: String) -> Response {
    let source = crate::accounts::source_for(&headers);
    let allowance = state.config.limits.resets_per_hour;
    let looked_up = email.clone();

    let outcome = state
        .db
        .call(move |connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            if let Some(seconds) = crate::accounts::window(
                &transaction,
                "source_window",
                &source,
                "reset",
                allowance,
                SOURCE_WINDOW_SECONDS,
            )? {
                transaction.commit()?;
                return Ok(Err(seconds));
            }

            let account: Option<i64> = transaction
                .query_row(
                    "SELECT id FROM account WHERE email = ?1 AND verified = 1",
                    params![looked_up],
                    |row| row.get(0),
                )
                .optional()?;

            let code = account.map(|account_id| {
                let code = random_code();
                let _ = transaction.execute(
                    "INSERT INTO mail_token (hash, account_id, kind, expires_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        sha256_hex(&code.replace('-', "")),
                        account_id,
                        LetterKind::Reset.as_str(),
                        now() + RESET_TOKEN_SECONDS
                    ],
                );
                code
            });
            transaction.commit()?;
            Ok(Ok(code))
        })
        .await;

    match outcome {
        Err(error) => server_error(error).into_response(),
        Ok(Err(seconds)) => crate::accounts::retry_after(seconds).into_response(),
        Ok(Ok(code)) => {
            if let Some(code) = code {
                // A reset letter that cannot be sent still answers 202: saying otherwise would
                // tell a stranger which addresses have an account, which is the whole reason this
                // route answers the same either way.
                let _ = crate::accounts::deliver(&state, LetterKind::Reset, &email, &code).await;
            }
            // **Always 202**, whether or not that address has an account. Registration has to
            // refuse a taken address and therefore leaks one; this route has no such obligation,
            // so it does not leak (D4a).
            (StatusCode::ACCEPTED, Json(json!({}))).into_response()
        }
    }
}

async fn complete(
    state: Arc<AppState>,
    fields: Value,
    email: String,
    presented: String,
) -> Response {
    let Some(code) = normalise_code(&presented) else {
        return bad_code().into_response();
    };
    let (Some(a), Some(salt), Some(wrapped_password), Some(wrapped_recovery)) = (
        field(&fields, "a"),
        field(&fields, "saltAccount"),
        field(&fields, "wrappedMkPassword"),
        field(&fields, "wrappedMkRecovery"),
    ) else {
        return bad_code().into_response();
    };

    let verifier = peppered(&state.config.pepper, a);
    let (salt, wrapped_password, wrapped_recovery) = (
        salt.to_owned(),
        wrapped_password.to_owned(),
        wrapped_recovery.to_owned(),
    );

    let outcome = state
        .db
        .call(move |connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let account_id: Option<i64> = transaction
                .query_row(
                    "SELECT id FROM account WHERE email = ?1",
                    params![email],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(account_id) = account_id else {
                transaction.commit()?;
                return Ok(None);
            };
            if !crate::accounts::spend(&transaction, account_id, &code, LetterKind::Reset)? {
                transaction.commit()?;
                return Ok(None);
            }

            let deleted: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM record WHERE account_id = ?1 AND deleted = 0",
                params![account_id],
                |row| row.get(0),
            )?;

            // **Outright, not tombstoned**: a tombstone exists to tell a machine that something it
            // can read is gone, and after this no machine can read anything. `next_seq` is
            // untouched — it is monotonic for the life of the account, and restarting it would
            // hand a machine still holding an old cursor an answer that looks like "no news".
            transaction.execute(
                "DELETE FROM record WHERE account_id = ?1",
                params![account_id],
            )?;
            transaction.execute(
                "UPDATE account SET verifier = ?1, salt_account = ?2, wrapped_mk_password = ?3,
                                    wrapped_mk_recovery = ?4, stored_bytes = 0, verified = 1
                 WHERE id = ?5",
                params![
                    verifier,
                    salt,
                    wrapped_password,
                    wrapped_recovery,
                    account_id
                ],
            )?;
            transaction.execute(
                "DELETE FROM token WHERE account_id = ?1",
                params![account_id],
            )?;
            transaction.commit()?;
            Ok(Some(deleted))
        })
        .await;

    match outcome {
        Err(error) => server_error(error).into_response(),
        Ok(None) => bad_code().into_response(),
        Ok(Some(records_deleted)) => {
            Json(json!({ "recordsDeleted": records_deleted })).into_response()
        }
    }
}

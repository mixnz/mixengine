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
use crate::crypto::{
    SALT_BYTES, VERIFIER_BYTES, WRAPPED_KEY_BYTES, account_key, normalise_code, now, peppered,
    random_code, same_secret, sha256_hex,
};
use crate::email::LetterKind;
use crate::freeze::guard;
use crate::http::{Failure, invalid_request, invalid_token};
use crate::validate::{is_base64, is_email};

const RESET_TOKEN_SECONDS: i64 = 60 * 60;
/// The kind a reset ticket is stored under, beside the letters and never sent as one (D6).
const RESET_TICKET_KIND: &str = "reset-ticket";
const SOURCE_WINDOW_SECONDS: i64 = 60 * 60;

/// Fixed lengths, for the reason `accounts::sized_field` gives (D4a).
fn field<'a>(fields: &'a Value, name: &str, bytes: usize) -> Option<&'a str> {
    fields
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| is_base64(value, Some(bytes)))
}

fn server_error(error: impl std::fmt::Display) -> Failure {
    tracing::error!("database error: {error}");
    Failure::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server-error",
        "Something went wrong on the server.",
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
        field(&fields, "a", VERIFIER_BYTES),
        field(&fields, "newA", VERIFIER_BYTES),
        field(&fields, "newSaltAccount", SALT_BYTES),
        field(&fields, "newWrappedMkPassword", WRAPPED_KEY_BYTES),
    ) else {
        return invalid_request(
            "The request needs the current verifier and a new one with its salt.",
        )
        .into_response();
    };

    if let Some(failure) = guard(&state, &headers).await {
        return failure.into_response();
    }
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
        return crate::http::invalid_email().into_response();
    };
    let email = email.trim().to_lowercase();

    match (
        fields.get("ticket").and_then(Value::as_str),
        fields.get("token").and_then(Value::as_str),
    ) {
        // D6 case 2, second request: the ticket was earned by spending the code.
        (Some(ticket), _) => keep(state, fields.clone(), email, ticket.to_owned()).await,
        // D6 case 2, first request: a code and nothing else asks for the wrapped key.
        (None, Some(token)) if fields.get("a").is_none() => {
            open(state, email, token.to_owned()).await
        }
        // D6 case 3, unchanged: the code carries the new keys and the records go.
        (None, Some(token)) => complete(state, fields.clone(), email, token.to_owned()).await,
        (None, None) => ask(state, headers, email).await,
    }
}

async fn ask(state: Arc<AppState>, headers: HeaderMap, email: String) -> Response {
    let source = crate::accounts::source_for(&headers);
    let allowance = state.config.limits.resets_per_hour;
    let letters = state.config.limits.letters_per_account_per_hour;
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
                    "SELECT id FROM account WHERE account_key = ?1 AND verified = 1",
                    params![account_key(&looked_up)],
                    |row| row.get(0),
                )
                .optional()?;

            // **An address over its allowance still answers 202, with no letter.** It cannot
            // answer 429: this route answers alike for an address that has an account and one
            // that does not, so a refusal only a throttled address could meet would tell them
            // apart (D4a).
            let account = match account {
                Some(account_id)
                    if crate::accounts::may_send_letter(
                        &transaction,
                        &account_key(&looked_up),
                        letters,
                    )?
                    .is_none() =>
                {
                    Some(account_id)
                }
                _ => None,
            };

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
        field(&fields, "a", VERIFIER_BYTES),
        field(&fields, "saltAccount", SALT_BYTES),
        field(&fields, "wrappedMkPassword", WRAPPED_KEY_BYTES),
        field(&fields, "wrappedMkRecovery", WRAPPED_KEY_BYTES),
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
                    "SELECT id FROM account WHERE account_key = ?1",
                    params![account_key(&email)],
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

/// **D6 case 2, first request.** A code and nothing else asks for the copy of `MK` wrapped under
/// the recovery key. Spending the code here is what earns it, so one code cannot mint two tickets.
async fn open(state: Arc<AppState>, email: String, presented: String) -> Response {
    let Some(code) = normalise_code(&presented) else {
        return bad_code().into_response();
    };
    let key = account_key(&email);
    let lifetime = state.config.limits.reset_ticket_seconds;

    let outcome = state
        .db
        .call(move |connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let account: Option<(i64, String)> = transaction
                .query_row(
                    "SELECT id, wrapped_mk_recovery FROM account
                     WHERE account_key = ?1 AND verified = 1",
                    params![key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            let Some((account_id, wrapped_recovery)) = account else {
                transaction.commit()?;
                return Ok(None);
            };
            if !crate::accounts::spend(&transaction, account_id, &code, LetterKind::Reset)? {
                transaction.commit()?;
                return Ok(None);
            }

            let ticket = crate::crypto::random_token();
            transaction.execute(
                "INSERT INTO mail_token (hash, account_id, kind, expires_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    sha256_hex(&ticket),
                    account_id,
                    RESET_TICKET_KIND,
                    now() + lifetime
                ],
            )?;
            transaction.commit()?;
            Ok(Some((wrapped_recovery, ticket)))
        })
        .await;

    match outcome {
        Err(error) => server_error(error).into_response(),
        Ok(None) => bad_code().into_response(),
        Ok(Some((wrapped_recovery, ticket))) => Json(json!({
            "wrappedMkRecovery": wrapped_recovery,
            "ticket": ticket,
            "expiresIn": lifetime,
        }))
        .into_response(),
    }
}

/// **D6 case 2, second request.** The client unwrapped `MK` with the recovery key and is setting a
/// new password. The records stay, because the client says it re-wrapped the same `MK` — which
/// this server cannot check and does not try.
async fn keep(state: Arc<AppState>, fields: Value, email: String, ticket: String) -> Response {
    let (Some(a), Some(salt), Some(wrapped_password), Some(wrapped_recovery)) = (
        field(&fields, "a", VERIFIER_BYTES),
        field(&fields, "saltAccount", SALT_BYTES),
        field(&fields, "wrappedMkPassword", WRAPPED_KEY_BYTES),
        field(&fields, "wrappedMkRecovery", WRAPPED_KEY_BYTES),
    ) else {
        return invalid_request("The request needs a verifier, a salt and two wrapped keys.")
            .into_response();
    };

    let key = account_key(&email);
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
                    "SELECT id FROM account WHERE account_key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(account_id) = account_id else {
                transaction.commit()?;
                return Ok(false);
            };
            if !crate::accounts::spend_kind(&transaction, account_id, &ticket, RESET_TICKET_KIND)? {
                transaction.commit()?;
                return Ok(false);
            }

            transaction.execute(
                "UPDATE account SET verifier = ?1, salt_account = ?2, wrapped_mk_password = ?3,
                                    wrapped_mk_recovery = ?4
                 WHERE id = ?5",
                params![
                    verifier,
                    salt,
                    wrapped_password,
                    wrapped_recovery,
                    account_id
                ],
            )?;
            // Every machine is signed out, as in case 3. **`record`, `stored_bytes` and `next_seq`
            // are untouched**: a machine still holding a cursor must not be told that nothing has
            // changed.
            transaction.execute(
                "DELETE FROM token WHERE account_id = ?1",
                params![account_id],
            )?;
            transaction.commit()?;
            Ok(true)
        })
        .await;

    match outcome {
        Err(error) => server_error(error).into_response(),
        Ok(false) => Failure::new(
            StatusCode::UNAUTHORIZED,
            "invalid-token",
            "That ticket is invalid or has expired.",
        )
        .into_response(),
        Ok(true) => Json(json!({ "recordsDeleted": 0 })).into_response(),
    }
}

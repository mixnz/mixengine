//! Accounts, tokens and devices — and the transactions the Durable Object did not need.
//!
//! Every place below that says `BEGIN IMMEDIATE` is standing in for something the Worker gets from
//! its object being the only thing running. The comments name which one, because that is the
//! difference the second implementation exists to make visible.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::AppState;
use crate::crypto::{now, peppered, random_token, same_secret, sha256_hex};
use crate::email::LetterKind;
use crate::http::{Failure, invalid_request, invalid_token};
use crate::validate::{is_base64, is_email};

pub const ACCESS_TOKEN_SECONDS: i64 = 15 * 60;
const REFRESH_TOKEN_SECONDS: i64 = 90 * 24 * 60 * 60;
const VERIFICATION_TOKEN_SECONDS: i64 = 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS: i64 = 15 * 60;
const SOURCE_WINDOW_SECONDS: i64 = 60 * 60;

pub fn parse(body: &str) -> Result<Value, Failure> {
    serde_json::from_str::<Value>(body)
        .ok()
        .filter(Value::is_object)
        .ok_or_else(|| invalid_request("The body is not a JSON object."))
}

fn text<'a>(fields: &'a Value, name: &str) -> Option<&'a str> {
    fields.get(name).and_then(Value::as_str)
}

fn base64_field<'a>(fields: &'a Value, name: &str) -> Option<&'a str> {
    text(fields, name).filter(|value| is_base64(value, None))
}

fn internal(error: impl std::fmt::Display) -> Failure {
    tracing::error!("database error: {error}");
    Failure::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server-error",
        "Something went wrong here.",
    )
}

/// The session behind a bearer token. **The same lookup that authenticates is the one that would
/// notice a revocation**, which is why deleting a device ends both its tokens at once and costs
/// nothing to do (D4a).
pub struct Session {
    pub account_id: i64,
    pub device_id: String,
}

pub fn authenticate(connection: &Connection, headers: &HeaderMap) -> Option<Session> {
    let presented = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?;

    connection
        .query_row(
            "SELECT account_id, device_id FROM token
             WHERE hash = ?1 AND kind = 'access' AND expires_at > ?2",
            params![sha256_hex(presented), now()],
            |row| {
                Ok(Session {
                    account_id: row.get(0)?,
                    device_id: row.get(1)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
        .inspect(|session| {
            let _ = connection.execute(
                "UPDATE device SET last_seen_at = ?1 WHERE id = ?2",
                params![now(), session.device_id],
            );
        })
}

/// A fixed window. `Some(seconds)` means refuse. The allowance is configuration and is not
/// reported by `/v1/capabilities`: publishing the number that stops abuse helps only the abuser.
pub(crate) fn window(
    connection: &Connection,
    table: &str,
    key: &dyn rusqlite::ToSql,
    action: &str,
    allowance: u64,
    window: i64,
) -> rusqlite::Result<Option<i64>> {
    let at = now();
    let column = if table == "attempt" {
        "account_id"
    } else {
        "source"
    };
    let existing: Option<(i64, i64)> = connection
        .query_row(
            &format!("SELECT count, started_at FROM {table} WHERE {column} = ?1 AND action = ?2"),
            params![key, action],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    match existing {
        Some((count, started_at)) if at - started_at < window => {
            if count as u64 >= allowance {
                return Ok(Some(started_at + window - at));
            }
            connection.execute(
                &format!(
                    "UPDATE {table} SET count = count + 1 WHERE {column} = ?1 AND action = ?2"
                ),
                params![key, action],
            )?;
        }
        _ => {
            connection.execute(
                &format!(
                    "INSERT INTO {table} ({column}, action, count, started_at) VALUES (?1, ?2, 1, ?3)
                     ON CONFLICT ({column}, action) DO UPDATE SET count = 1, started_at = excluded.started_at"
                ),
                params![key, action, at],
            )?;
        }
    }
    Ok(None)
}

pub(crate) fn source_for(headers: &HeaderMap) -> String {
    // Behind a proxy this is what the proxy set; direct, it is absent and one shared bucket is the
    // honest answer. A self-hoster who cares sets `X-Forwarded-For` at their reverse proxy.
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(|value| sha256_hex(value.trim()))
        .unwrap_or_else(|| "local".to_owned())
}

pub(crate) fn retry_after(seconds: i64) -> Failure {
    Failure::new(
        StatusCode::TOO_MANY_REQUESTS,
        "too-many-requests",
        "Too many requests.",
    )
    .header(
        header::RETRY_AFTER,
        seconds
            .to_string()
            .parse()
            .expect("a number is a valid header"),
    )
}

// --- registration ------------------------------------------------------------------------------

pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };

    let (Some(email), Some(a), Some(salt), Some(wrapped_password), Some(wrapped_recovery)) = (
        text(&fields, "email").filter(|value| is_email(value)),
        base64_field(&fields, "a"),
        base64_field(&fields, "saltAccount"),
        base64_field(&fields, "wrappedMkPassword"),
        base64_field(&fields, "wrappedMkRecovery"),
    ) else {
        return invalid_request("An address, a verifier, a salt and two wrapped keys.")
            .into_response();
    };

    let argon = ["m", "t", "p"].map(|name| {
        fields
            .get("argon")
            .and_then(|argon| argon.get(name))
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
    });
    let [Some(m), Some(t), Some(p)] = argon else {
        return invalid_request("The Argon2 parameters the client derived with.").into_response();
    };

    let email = email.trim().to_lowercase();
    let verifier = peppered(&state.config.pepper, a);
    let (salt, wrapped_password, wrapped_recovery) = (
        salt.to_owned(),
        wrapped_password.to_owned(),
        wrapped_recovery.to_owned(),
    );
    let source = source_for(&headers);
    let allowance = state.config.limits.registrations_per_hour;
    let letter_email = email.clone();

    let outcome = state
        .db
        .call(move |connection| {
            // **The registration race.** The Worker settles it by two attempts arriving at one
            // serialized object; here they arrive at one file, so the check and the insert are one
            // write transaction or the check means nothing.
            let transaction = connection.transaction_with_behavior(
                rusqlite::TransactionBehavior::Immediate,
            )?;

            if let Some(seconds) = window(
                &transaction,
                "source_window",
                &source,
                "register",
                allowance,
                SOURCE_WINDOW_SECONDS,
            )? {
                transaction.commit()?;
                return Ok(Err(retry_after(seconds)));
            }

            let taken: Option<i64> = transaction
                .query_row(
                    "SELECT id FROM account WHERE email = ?1",
                    params![email],
                    |row| row.get(0),
                )
                .optional()?;
            if taken.is_some() {
                transaction.commit()?;
                return Ok(Err(Failure::new(
                    StatusCode::CONFLICT,
                    "email-taken",
                    "That address already has an account.",
                )));
            }

            transaction.execute(
                "INSERT INTO account (email, verifier, salt_account, argon_m, argon_t, argon_p,
                                      wrapped_mk_password, wrapped_mk_recovery, verified, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)",
                params![email, verifier, salt, m, t, p, wrapped_password, wrapped_recovery, now()],
            )?;
            let account_id = transaction.last_insert_rowid();

            let token = random_token();
            transaction.execute(
                "INSERT INTO mail_token (hash, account_id, kind, expires_at) VALUES (?1, ?2, ?3, ?4)",
                params![
                    sha256_hex(&token),
                    account_id,
                    LetterKind::Verification.as_str(),
                    now() + VERIFICATION_TOKEN_SECONDS
                ],
            )?;
            transaction.commit()?;
            Ok(Ok(token))
        })
        .await;

    match outcome {
        Err(error) => internal(error).into_response(),
        Ok(Err(failure)) => failure.into_response(),
        Ok(Ok(token)) => {
            deliver(&state, LetterKind::Verification, &letter_email, &token).await;
            (StatusCode::CREATED, Json(json!({}))).into_response()
        }
    }
}

/// Either records the letter where the suite can read it, or sends it. The first is refused unless
/// the server was started in test-outbox mode, which is checked where the route is.
pub async fn deliver(state: &Arc<AppState>, kind: LetterKind, email: &str, token: &str) {
    if state.config.test_outbox {
        let (email, token, kind) = (email.to_owned(), token.to_owned(), kind.as_str());
        let _ = state
            .db
            .call(move |connection| {
                connection.execute(
                    "INSERT INTO outbox (account_id, kind, token, sent_at)
                     SELECT id, ?2, ?3, ?4 FROM account WHERE email = ?1",
                    params![email, kind, token, now()],
                )
            })
            .await;
        return;
    }

    let verify_url = format!(
        "{}/v1/auth/verify?email={}&token={}",
        state.config.public_url.trim_end_matches('/'),
        urlencode(email),
        token
    );
    if let Err(reason) = crate::email::send(&state.config, kind, email, token, &verify_url).await {
        tracing::error!("could not send the {} letter: {reason}", kind.as_str());
    }
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

// --- verification, signing in, tokens ----------------------------------------------------------

pub async fn verify(State(state): State<Arc<AppState>>, body: String) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };
    let (Some(email), Some(token)) = (text(&fields, "email"), text(&fields, "token")) else {
        return bad_link().into_response();
    };
    let (email, token) = (email.trim().to_lowercase(), token.to_owned());

    let outcome = state
        .db
        .call(move |connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let account: Option<(i64, i64)> = transaction
                .query_row(
                    "SELECT id, verified FROM account WHERE email = ?1",
                    params![email],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            // Already verified and the token already spent look alike on purpose: wrong, expired
            // and used answer with one code, because the sentence a person needs is the same.
            let Some((account_id, 0)) = account else {
                transaction.commit()?;
                return Ok(false);
            };
            if !spend(&transaction, account_id, &token, LetterKind::Verification)? {
                transaction.commit()?;
                return Ok(false);
            }
            transaction.execute(
                "UPDATE account SET verified = 1 WHERE id = ?1",
                params![account_id],
            )?;
            transaction.commit()?;
            Ok(true)
        })
        .await;

    match outcome {
        Err(error) => internal(error).into_response(),
        Ok(false) => bad_link().into_response(),
        Ok(true) => Json(json!({})).into_response(),
    }
}

fn bad_link() -> Failure {
    Failure::new(
        StatusCode::BAD_REQUEST,
        "invalid-token",
        "That link is not usable.",
    )
}

pub(crate) fn spend(
    connection: &Connection,
    account_id: i64,
    presented: &str,
    kind: LetterKind,
) -> rusqlite::Result<bool> {
    let hash = sha256_hex(presented);
    let found: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM mail_token
             WHERE hash = ?1 AND account_id = ?2 AND kind = ?3 AND used = 0 AND expires_at > ?4",
            params![hash, account_id, kind.as_str(), now()],
            |row| row.get(0),
        )
        .optional()?;
    if found.is_none() {
        return Ok(false);
    }
    connection.execute(
        "UPDATE mail_token SET used = 1 WHERE hash = ?1",
        params![hash],
    )?;
    Ok(true)
}

pub async fn login(State(state): State<Arc<AppState>>, body: String) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };
    let (Some(email), Some(a), Some(device_name)) = (
        text(&fields, "email").filter(|value| is_email(value)),
        base64_field(&fields, "a"),
        text(&fields, "deviceName").filter(|value| !value.trim().is_empty() && value.len() <= 128),
    ) else {
        return invalid_request("An address, a verifier and a name for this machine.")
            .into_response();
    };

    let email = email.trim().to_lowercase();
    let presented = peppered(&state.config.pepper, a);
    let device_name = device_name.trim().to_owned();
    let allowance = state.config.limits.logins_per_window;

    let outcome = state
        .db
        .call(move |connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let account: Option<(i64, String, i64)> = transaction
                .query_row(
                    "SELECT id, verifier, verified FROM account WHERE email = ?1",
                    params![email],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;

            // An unknown address and a wrong verifier answer alike. Registration has to refuse a
            // taken address and therefore leaks one; this route has no such obligation (D4a).
            let Some((account_id, stored, verified)) = account else {
                transaction.commit()?;
                return Ok(Err(wrong_credentials()));
            };

            if let Some(seconds) = window(
                &transaction,
                "attempt",
                &account_id,
                "login",
                allowance,
                LOGIN_WINDOW_SECONDS,
            )? {
                transaction.commit()?;
                return Ok(Err(retry_after(seconds)));
            }

            if !same_secret(&stored, &presented) {
                transaction.commit()?;
                return Ok(Err(wrong_credentials()));
            }
            if verified != 1 {
                transaction.commit()?;
                return Ok(Err(Failure::new(
                    StatusCode::FORBIDDEN,
                    "email-not-verified",
                    "Confirm the address before signing in.",
                )));
            }

            let device_id = random_token();
            transaction.execute(
                "INSERT INTO device (id, account_id, name, created_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![device_id, account_id, device_name, now()],
            )?;
            let session = issue(&transaction, account_id, &device_id)?;
            transaction.commit()?;
            Ok(Ok((session, device_id)))
        })
        .await;

    match outcome {
        Err(error) => internal(error).into_response(),
        Ok(Err(failure)) => failure.into_response(),
        Ok(Ok(((access, refresh), device_id))) => Json(json!({
            "accessToken": access,
            "refreshToken": refresh,
            "deviceId": device_id,
            "expiresIn": ACCESS_TOKEN_SECONDS,
        }))
        .into_response(),
    }
}

fn wrong_credentials() -> Failure {
    Failure::new(
        StatusCode::UNAUTHORIZED,
        "invalid-credentials",
        "That address and password do not match an account.",
    )
}

fn issue(
    connection: &Connection,
    account_id: i64,
    device_id: &str,
) -> rusqlite::Result<(String, String)> {
    let access = random_token();
    let refresh = random_token();
    let at = now();
    connection.execute(
        "INSERT INTO token (hash, account_id, kind, device_id, expires_at)
         VALUES (?1, ?2, 'access', ?3, ?4)",
        params![
            sha256_hex(&access),
            account_id,
            device_id,
            at + ACCESS_TOKEN_SECONDS
        ],
    )?;
    connection.execute(
        "INSERT INTO token (hash, account_id, kind, device_id, expires_at)
         VALUES (?1, ?2, 'refresh', ?3, ?4)",
        params![
            sha256_hex(&refresh),
            account_id,
            device_id,
            at + REFRESH_TOKEN_SECONDS
        ],
    )?;
    Ok((access, refresh))
}

pub async fn refresh(State(state): State<Arc<AppState>>, body: String) -> Response {
    let fields = match parse(&body) {
        Ok(fields) => fields,
        Err(failure) => return failure.into_response(),
    };
    let Some(presented) = text(&fields, "refreshToken") else {
        return invalid_token().into_response();
    };
    let hash = sha256_hex(presented);

    let outcome = state
        .db
        .call(move |connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let row: Option<(i64, String, i64)> = transaction
                .query_row(
                    "SELECT account_id, device_id, rotated FROM token
                     WHERE hash = ?1 AND kind = 'refresh' AND expires_at > ?2",
                    params![hash, now()],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;

            let Some((account_id, device_id, rotated)) = row else {
                transaction.commit()?;
                return Ok(None);
            };

            if rotated == 1 {
                // Either it was copied, or two clients raced. Both want the person to sign in
                // again rather than continue quietly, so the device's whole chain goes (D4a).
                transaction
                    .execute("DELETE FROM token WHERE device_id = ?1", params![device_id])?;
                transaction.commit()?;
                return Ok(None);
            }

            transaction.execute(
                "UPDATE token SET rotated = 1 WHERE hash = ?1",
                params![hash],
            )?;
            transaction.execute(
                "DELETE FROM token WHERE device_id = ?1 AND kind = 'access'",
                params![device_id],
            )?;
            let session = issue(&transaction, account_id, &device_id)?;
            transaction.execute(
                "UPDATE device SET last_seen_at = ?1 WHERE id = ?2",
                params![now(), device_id],
            )?;
            transaction.commit()?;
            Ok(Some(session))
        })
        .await;

    match outcome {
        Err(error) => internal(error).into_response(),
        Ok(None) => invalid_token().into_response(),
        Ok(Some((access, refresh))) => Json(json!({
            "accessToken": access,
            "refreshToken": refresh,
            "expiresIn": ACCESS_TOKEN_SECONDS,
        }))
        .into_response(),
    }
}

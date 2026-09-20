//! The device list, and cutting off a machine somebody lost.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rusqlite::params;
use serde_json::json;

use crate::AppState;
use crate::accounts::authenticate;
use crate::http::{Failure, invalid_token};
use crate::relocation::guard;

pub async fn list(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Some(failure) = guard(&state, &headers, false).await {
        return failure.into_response();
    }
    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(None);
            };
            let mut statement = connection.prepare(
                "SELECT id, name, created_at, last_seen_at FROM device
                 WHERE account_id = ?1 ORDER BY created_at ASC",
            )?;
            let devices = statement
                .query_map(params![session.account_id], |row| {
                    let id: String = row.get(0)?;
                    Ok(json!({
                        "current": id == session.device_id,
                        "id": id,
                        "name": row.get::<_, String>(1)?,
                        "createdAt": row.get::<_, i64>(2)?,
                        "lastSeenAt": row.get::<_, i64>(3)?,
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(Some(devices))
        })
        .await;

    match outcome {
        Err(error) => {
            tracing::error!("database error: {error}");
            Failure::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server-error",
                "Something went wrong here.",
            )
            .into_response()
        }
        Ok(None) => invalid_token().into_response(),
        Ok(Some(devices)) => Json(json!({ "devices": devices })).into_response(),
    }
}

pub async fn remove(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Some(failure) = guard(&state, &headers, false).await {
        return failure.into_response();
    }
    let outcome = state
        .db
        .call(move |connection| {
            let Some(session) = authenticate(connection, &headers) else {
                return Ok(None);
            };
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let removed = transaction.execute(
                "DELETE FROM device WHERE id = ?1 AND account_id = ?2",
                params![id, session.account_id],
            )?;
            if removed == 1 {
                // **Both tokens, at once.** A token here is a string the server looks up, so the
                // lookup that would notice a revocation is the same one that authenticates: there
                // is nothing to pay for cutting a lost machine off now rather than in fifteen
                // minutes, and cutting it off is the whole purpose of the route (D4a).
                transaction.execute("DELETE FROM token WHERE device_id = ?1", params![id])?;
            }
            transaction.commit()?;
            Ok(Some(removed == 1))
        })
        .await;

    match outcome {
        Err(error) => {
            tracing::error!("database error: {error}");
            Failure::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server-error",
                "Something went wrong here.",
            )
            .into_response()
        }
        Ok(None) => invalid_token().into_response(),
        // 404 and not 403: a 403 would confirm that the device exists on somebody else's account.
        Ok(Some(false)) => Failure::new(
            StatusCode::NOT_FOUND,
            "unknown-device",
            "No such device on this account.",
        )
        .into_response(),
        Ok(Some(true)) => StatusCode::NO_CONTENT.into_response(),
    }
}

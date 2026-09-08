//! Every Redis command.

use crate::modules::db::models::ServerInfo;
use crate::error::AppError;
use tauri::State;
use serde_json::Value;
use crate::modules::db::drivers::redis as redis_db;
use crate::modules::db::state::DbState;
use super::redis_connection;

#[tauri::command]
pub async fn redis_command(
    state: State<'_, DbState>,
    id: String,
    args: Vec<String>,
) -> Result<Value, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::run_command(conn.commands(), args).await
}

#[tauri::command]
pub async fn redis_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<ServerInfo, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::server_info(conn.commands()).await
}

#[tauri::command]
pub async fn redis_list_databases(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<redis_db::DbInfo>, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::list_databases(conn.commands()).await
}

#[tauri::command]
pub async fn redis_select_db(
    state: State<'_, DbState>,
    id: String,
    index: i64,
) -> Result<(), AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::select_db(&mut conn, index).await
}

#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, DbState>,
    id: String,
    pattern: String,
    cursor: String,
    count: i64,
) -> Result<redis_db::KeyPage, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::scan_keys(conn.commands(), &pattern, &cursor, count).await
}

#[tauri::command]
pub async fn redis_key_value(
    state: State<'_, DbState>,
    id: String,
    key: String,
    cursor: Option<String>,
    count: i64,
) -> Result<redis_db::KeyValuePage, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::key_value(conn.commands(), &key, cursor.as_deref(), count).await
}

#[tauri::command]
pub async fn redis_delete_keys(
    state: State<'_, DbState>,
    id: String,
    keys: Vec<String>,
) -> Result<i64, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::delete_keys(conn.commands(), &keys).await
}

//! The account and the loop as the shell asks for them. Each is one call into [`SyncState`]; what
//! they mean is `session`'s.

use tauri::State;

use super::account::Device;
use super::lend::Item;
use super::session::{PulledPage, PushedChanges, Status, SyncState};
use crate::error::AppError;

#[tauri::command]
pub async fn sync_status(state: State<'_, SyncState>) -> Result<Status, AppError> {
    state.status().await
}

/// Returns the recovery key, formatted: the one time it is ever shown (D2).
#[tauri::command]
pub async fn sync_register(
    state: State<'_, SyncState>,
    server: String,
    access: Option<String>,
    email: String,
    password: String,
) -> Result<String, AppError> {
    state
        .register(&server, access.as_deref(), &email, password)
        .await
}

#[tauri::command]
pub async fn sync_verify(
    state: State<'_, SyncState>,
    code: String,
    device_name: String,
) -> Result<Status, AppError> {
    state.verify(&code, &device_name).await
}

#[tauri::command]
pub async fn sync_login(
    state: State<'_, SyncState>,
    server: String,
    access: Option<String>,
    email: String,
    password: String,
    device_name: String,
) -> Result<Status, AppError> {
    state
        .login(&server, access.as_deref(), &email, password, &device_name)
        .await
}

#[tauri::command]
pub async fn sync_logout(state: State<'_, SyncState>) -> Result<(), AppError> {
    state.logout().await
}

#[tauri::command]
pub async fn sync_devices(state: State<'_, SyncState>) -> Result<Vec<Device>, AppError> {
    state.devices().await
}

#[tauri::command]
pub async fn sync_revoke_device(state: State<'_, SyncState>, id: String) -> Result<(), AppError> {
    state.revoke(&id).await
}

#[tauri::command]
pub async fn sync_pull_page(
    state: State<'_, SyncState>,
    collection: String,
) -> Result<PulledPage, AppError> {
    state.pull_page(&collection).await
}

#[tauri::command]
pub async fn sync_commit_pull(
    state: State<'_, SyncState>,
    collection: String,
    token: String,
) -> Result<(), AppError> {
    state.commit_pull(&collection, &token).await
}

#[tauri::command]
pub async fn sync_push(
    state: State<'_, SyncState>,
    collection: String,
    items: Vec<Item>,
) -> Result<PushedChanges, AppError> {
    state.push(&collection, items).await
}

#[tauri::command]
pub async fn sync_commit_push(
    state: State<'_, SyncState>,
    collection: String,
    token: String,
) -> Result<(), AppError> {
    state.commit_push(&collection, &token).await
}

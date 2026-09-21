//! The account and the loop as the shell asks for them. Each is one call into [`SyncState`]; what
//! they mean is `session`'s.

use tauri::State;

use super::account::Device;
use super::lend::Item;
use super::session::{PulledPage, PushedChanges, Status, SyncState};
use crate::error::AppError;

/// What this machine calls itself — offered as its name in the device list, and changed by the
/// person if they like. `MixLab` when the operating system has nothing to say.
pub(crate) fn device_name() -> String {
    let name = gethostname::gethostname()
        .to_string_lossy()
        .trim()
        .to_owned();
    if name.is_empty() {
        "MixLab".to_owned()
    } else {
        name
    }
}

#[tauri::command]
pub fn sync_device_name() -> String {
    device_name()
}

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

#[tauri::command]
pub async fn sync_change_password(
    state: State<'_, SyncState>,
    current: String,
    next: String,
) -> Result<(), AppError> {
    state.change_password(current, next).await
}

#[tauri::command]
pub async fn sync_reset_ask(
    state: State<'_, SyncState>,
    server: String,
    access: Option<String>,
    email: String,
) -> Result<(), AppError> {
    state.ask_reset(&server, access.as_deref(), &email).await
}

#[tauri::command]
pub async fn sync_reset_open(
    state: State<'_, SyncState>,
    server: String,
    access: Option<String>,
    email: String,
    code: String,
) -> Result<(), AppError> {
    state
        .open_reset(&server, access.as_deref(), &email, &code)
        .await
}

#[tauri::command]
pub async fn sync_reset_keep(
    state: State<'_, SyncState>,
    recovery_key: String,
    password: String,
    device_name: String,
) -> Result<Status, AppError> {
    state
        .reset_keeping(&recovery_key, password, &device_name)
        .await
}

/// Returns the new recovery key: shown once, in case 3's ceremony.
#[tauri::command]
pub async fn sync_reset_prepare(
    state: State<'_, SyncState>,
    server: String,
    access: Option<String>,
    email: String,
    password: String,
) -> Result<String, AppError> {
    state
        .prepare_start_over(&server, access.as_deref(), &email, password)
        .await
}

#[tauri::command]
pub async fn sync_reset_start_over(
    state: State<'_, SyncState>,
    code: String,
    device_name: String,
) -> Result<Status, AppError> {
    state.start_over(&code, &device_name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Offered as the machine's name in the device list, so it is never empty: a blank name is the
    /// one the server refuses (`invalid-device-name`).
    #[test]
    fn a_machine_always_has_a_name() {
        assert!(!device_name().trim().is_empty());
    }
}

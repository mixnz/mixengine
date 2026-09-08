//! The one command the handoff needs: the tab opened for it takes what was handed over, once.

use tauri::State;

use crate::error::AppError;
use crate::modules::db::handoff::{Handoff, HandoffState};

/// The handoff under `id`, removed as it is handed out. A second call, or an id from a session
/// written by an earlier run, is `error.handoffExpired` — which the tab answers with an empty
/// form and no banner, since nothing the user did has failed.
#[tauri::command]
pub fn handoff_take(state: State<'_, HandoffState>, id: String) -> Result<Handoff, AppError> {
    state.take(&id).ok_or_else(|| err!("error.handoffExpired"))
}

use crate::platform::{app_data_dir, in_background};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use super::models::{LocalShell, Output, OutputSink, TerminalEvent, TerminalSize, TerminalTarget};
use super::state::TerminalState;
use super::{local, remote};
use crate::error::AppError;

/// Máy này mở được shell nào. Dò bằng cách nhìn đĩa và — trên Windows — hỏi `wsl.exe`, nên chạy
/// trên thread blocking chứ không giữ vòng lặp async.
#[tauri::command]
pub async fn terminal_local_shells() -> Result<Vec<LocalShell>, AppError> {
    tokio::task::spawn_blocking(local::detect)
        .await
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))
}

/// Mở một phiên và nối nó với `on_event`.
///
/// `Data` đi dạng byte thô, `Exit` đi dạng JSON, trên cùng một kênh — `Channel` đánh số thứ tự cho
/// mọi khung và phía JS xếp lại theo số đó, nên `Exit` không thể vượt lên trước byte cuối.
///
/// `Exit` cũng là lúc phiên rời map. Frontend chỉ gọi `terminal_close` cho một tab đóng khi phiên
/// còn sống, nên một phiên tự kết thúc — gõ `exit`, máy chủ ngắt — mà không được bỏ ở đây thì nằm
/// lại tới lúc app thoát, và cùng với nó là mọi thứ `Session` đang cầm.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    id: String,
    target: TerminalTarget,
    size: TerminalSize,
    on_event: Channel<InvokeResponseBody>,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    /* Phiên đã kết thúc chưa, đọc lại sau khi chèn. Một shell chết ngay — lệnh không tồn tại, một
       máy chủ đóng ngay sau banner — phát `Exit` trước khi `spawn` kịp trả về, và lúc ấy không có
       gì trong map để bỏ. Cờ này là cách chỗ chèn biết nó vừa chèn một phiên đã chết. */
    let ended = Arc::new(AtomicBool::new(false));
    let sink = output_sink(on_event, ended.clone(), {
        let app = app.clone();
        let id = id.clone();
        move || app.state::<TerminalState>().forget(&id)
    });

    let session = match target {
        /* Off the runtime: opening a pty is ConPTY on Windows and `forkpty` on Unix, both
           blocking, and the shell behind it may be on a network drive or a WSL distribution that
           has to start first. */
        TerminalTarget::Local { shell, args, cwd } => {
            in_background(move || local::spawn(shell, args, cwd, size, sink)).await?
        }
        // Xác thực hỏng, vân tay đổi, máy chủ không tới được — tất cả hỏng ở đây, trước khi có
        // phiên nào để đưa vào map. Đó là thứ frontend đưa về `ErrorBanner` ngay tại form.
        TerminalTarget::Ssh(ssh) => remote::spawn(&ssh, &app_data_dir(&app)?, size, sink).await?,
    };

    // Cùng một id mở hai lần thì phiên cũ bị thay và `Drop` của nó dọn phần còn lại.
    let dead = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(id.clone(), session);
        // Đã chết trước khi kịp vào map: bỏ ra ngay, vì `Exit` đã đi qua và không quay lại nữa.
        if ended.load(Ordering::SeqCst) {
            sessions.remove(&id)
        } else {
            None
        }
    };
    // Ngoài phạm vi khoá, cùng lý do như `TerminalState::forget`.
    drop(dead);
    Ok(())
}

/// Đường ra của một phiên: `Data` đi thẳng dạng byte, `Exit` đi dạng JSON — và `Exit` cũng là lúc
/// phiên rời map, qua `forget`.
///
/// `ended` được đặt *trước* khi `forget` lấy khoá, vì chỗ chèn đọc cờ ấy *dưới* khoá. Bỏ sót chỉ
/// xảy ra nếu cả hai cùng thấy map trống, mà cái đó cần cờ được đặt sau khi chỗ chèn đã đọc nó và
/// trước khi nó chèn — hai việc chỗ chèn làm liền nhau dưới cùng một khoá.
///
/// Rời khỏi `terminal_open` để test gọi được: dựng một `AppHandle` giả tốn hơn nhiều so với gọi
/// thẳng chỗ này với một `TerminalState` của riêng nó.
fn output_sink(
    on_event: Channel<InvokeResponseBody>,
    ended: Arc<AtomicBool>,
    forget: impl Fn() + Send + Sync + 'static,
) -> OutputSink {
    Arc::new(move |output| match output {
        Output::Data(bytes) => {
            let _ = on_event.send(InvokeResponseBody::Raw(bytes));
        }
        Output::Exit { code, message } => {
            if let Ok(json) = serde_json::to_string(&TerminalEvent::Exit { code, message }) {
                let _ = on_event.send(InvokeResponseBody::Json(json));
            }
            ended.store(true, Ordering::SeqCst);
            forget();
        }
    })
}

/// Byte người dùng gõ. `data` là chuỗi chứ không phải base64: cái `onData` của xterm sinh ra luôn
/// là chuỗi hợp lệ, và UTF-8 của nó đúng là thứ cần ghi vào pty.
#[tauri::command]
pub async fn terminal_write(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| err!("error.terminalUnknownSession"))?;
    session
        .input
        .send(data.into_bytes())
        .map_err(|_| err!("error.terminalUnknownSession"))
}

#[tauri::command]
pub async fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| err!("error.terminalUnknownSession"))?;
    session
        .resize
        .send(TerminalSize { cols, rows })
        .map_err(|_| err!("error.terminalUnknownSession"))
}

/// Đóng phiên. Bỏ khỏi map là `Drop` chạy, là tiến trình bị giết — không có bước nào khác.
/// Một id không có trong map không phải lỗi: một phiên tự chết đã tự bỏ mình khỏi map khi phát
/// `Exit`, và tab đóng sau đó vẫn có quyền gọi.
#[tauri::command]
pub async fn terminal_close(id: String, state: State<'_, TerminalState>) -> Result<(), AppError> {
    state.sessions.lock().unwrap().remove(&id);
    Ok(())
}



#[cfg(test)]
mod tests {
    use super::{local, output_sink, TerminalState};
    use crate::modules::terminal::models::TerminalSize;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::ipc::Channel;

    /// Đường mà "gõ `exit` rồi để tab đấy" đi.
    ///
    /// Frontend không gọi `terminal_close` cho một tab đã thấy `Exit`, nên nếu `Exit` không tự bỏ
    /// phiên khỏi map thì `Session` nằm lại tới lúc app thoát — và cùng với nó là hai thread đang
    /// chờ trên hai channel của nó, hoặc, với một phiên SSH, cả kết nối TCP và keepalive 15 giây.
    ///
    /// Chạy đúng cái sink mà `terminal_open` dựng; chỗ duy nhất không đi qua đây là một dòng lấy
    /// `TerminalState` ra khỏi `AppHandle`. `exit 3` chứ không phải gõ `exit` vào một shell tương
    /// tác, cùng lý do như test trong `local.rs`.
    #[tokio::test]
    async fn a_session_that_ends_by_itself_leaves_the_map() {
        let state = Arc::new(TerminalState::default());
        let id = "phien-thu".to_string();

        let sink = output_sink(Channel::new(|_| Ok(())), Arc::new(AtomicBool::new(false)), {
            let state = state.clone();
            let id = id.clone();
            move || state.forget(&id)
        });

        let (shell, args) = if cfg!(windows) {
            (
                "cmd.exe",
                vec!["/c".to_string(), "exit".to_string(), "3".to_string()],
            )
        } else {
            ("/bin/sh", vec!["-c".to_string(), "exit 3".to_string()])
        };
        let session = local::spawn(
            Some(shell.to_string()),
            args,
            None,
            TerminalSize { cols: 80, rows: 24 },
            sink,
        )
        .expect("shell phải mở được");

        // ConPTY hỏi vị trí con trỏ rồi đợi trả lời trước khi cho tiến trình con chạy; trong app
        // thì xterm trả lời, ở đây thì không ai. Trả lời hộ nó — xem `local.rs`.
        session.input.send(b"\x1b[1;1R".to_vec()).unwrap();
        state.sessions.lock().unwrap().insert(id.clone(), session);

        let deadline = Instant::now() + Duration::from_millis(5000);
        while state.sessions.lock().unwrap().contains_key(&id) {
            assert!(Instant::now() < deadline, "hết hạn mà phiên vẫn còn trong map");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

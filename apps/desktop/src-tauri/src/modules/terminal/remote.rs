use std::path::Path;

use russh::ChannelMsg;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::models::{Output, OutputSink, TerminalSize};
use super::state::Session;
use super::stream::{coalesce, QUEUE_DEPTH};
use crate::error::AppError;
use crate::ssh::SshConfig;

/// Mở một shell trên máy chủ và trả về tay cầm của nó.
///
/// Cùng hình dạng `Session` với `local::spawn`, nên `commands.rs` không phân biệt được hai loại
/// phiên — và không cần phân biệt. Chỗ khác nhau nằm gọn trong hàm này: hai task tokio thay cho
/// bốn thread, một channel SSH thay cho một pty.
pub async fn spawn(
    ssh: &SshConfig,
    app_data: &Path,
    size: TerminalSize,
    out: OutputSink,
) -> Result<Session, AppError> {
    let (mut read, writer) = crate::ssh::open_shell(ssh, app_data, size.cols, size.rows)
        .await?
        .split();

    let (raw_tx, raw_rx) = mpsc::channel::<Vec<u8>>(QUEUE_DEPTH);
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<TerminalSize>();
    let (exit_tx, exit_rx) = oneshot::channel::<Option<i32>>();
    let kill = CancellationToken::new();

    // Đọc đầu xa. Đây là chỗ duy nhất giữ `raw_tx`, nên task này kết thúc là bộ gom lô biết đã hết
    // byte — và chỉ khi đó `Exit` mới được phát.
    tokio::spawn(async move {
        let mut code = None;
        while let Some(msg) = read.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    if raw_tx.send(data.to_vec()).await.is_err() {
                        break;
                    }
                }
                /* Một phiên có pty thường trộn stderr vào stdout, nhưng máy chủ vẫn được phép tách
                   ra — và một dòng lỗi không hiện lên màn hình thì tệ hơn là hiện lẫn vào dòng
                   khác. */
                ChannelMsg::ExtendedData { data, .. } => {
                    if raw_tx.send(data.to_vec()).await.is_err() {
                        break;
                    }
                }
                // Mã thoát tới trước khi channel đóng. Giữ lại, không phát ngay: đệm gom lô có thể
                // còn byte.
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status as i32),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                // `Success`/`Failure` của hai `request_*`, `WindowAdjusted` của điều khiển luồng.
                // Không có gì để làm với chúng.
                _ => {}
            }
        }
        let _ = exit_tx.send(code);
    });

    /* Ghi, đổi kích thước, đóng — một task, vì cả ba đi qua cùng một nửa ghi, và vì đây là chỗ giữ
       phiên SSH sống. Task này về là kết nối đóng. */
    tokio::spawn({
        let kill = kill.clone();
        async move {
            loop {
                tokio::select! {
                    bytes = input_rx.recv() => match bytes {
                        Some(bytes) => {
                            if writer.write(bytes).await.is_err() {
                                break;
                            }
                        }
                        // `Session` đã bị bỏ: đóng tab, hoặc app thoát.
                        None => break,
                    },
                    size = resize_rx.recv() => match size {
                        // Hỏng thì bỏ qua: một khung window_change trượt không làm phiên sai, và
                        // khung sau sẽ nói lại kích thước mới nhất.
                        Some(size) => { let _ = writer.resize(size.cols, size.rows).await; }
                        None => break,
                    },
                    _ = kill.cancelled() => break,
                }
            }
            writer.close().await;
        }
    });

    // Một đường ra, một thứ tự: hết byte → hết đệm → mới tới `Exit`. Giống hệt `local::spawn`, và
    // vì cùng lý do.
    tokio::spawn(async move {
        coalesce(raw_rx, |chunk| out(Output::Data(chunk))).await;
        let code = exit_rx.await.ok().flatten();
        out(Output::Exit {
            code,
            message: None,
        });
    });

    Ok(Session {
        input: input_tx,
        resize: resize_tx,
        kill,
    })
}

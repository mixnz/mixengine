//! Giữ `GET /metrics` mở và đẩy từng `MetricsFrame` lên UI — mirror của `events.rs`/`logs.rs`, khác
//! route (cố định, không tham số) và state (`MetricsState`, không phải `LogsState`/`MixEngineState`).
//!
//! **Mở kết nối này chính là subscribe.** MixEngine lấy mẫu 1 Hz trong lúc có ai giữ `/metrics`, và
//! rơi về 1 lần/phút khi không — đóng kết nối này ngay khi màn hình không còn cần số "bây giờ" nữa
//! (xem `MetricsState`) là phần bắt buộc để giữ đúng bất biến đó, không phải một chi tiết dọn dẹp.

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use hyper_util::rt::TokioIo;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::sse::Frames;
use super::state::MetricsState;
use super::transport::{self, Io};

/// Mở `GET /metrics` và chạy tới khi bị hủy hoặc kết nối đứt.
pub async fn stream_metrics(on_frame: Channel<String>, state: &MetricsState) -> Result<(), AppError> {
    let io = transport::connect().await?;

    let request = Request::builder()
        .method("GET")
        .uri("/metrics")
        .header("host", "mixengine")
        .header("accept", "text/event-stream")
        .body(Full::new(Bytes::new()))
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    match io {
        #[cfg(windows)]
        Io::Pipe(pipe) => open(TokioIo::new(pipe), request, on_frame, state).await,
        #[cfg(not(windows))]
        Io::Socket(socket) => open(TokioIo::new(socket), request, on_frame, state).await,
    }
}

async fn open<I>(
    io: TokioIo<I>,
    request: Request<Full<Bytes>>,
    on_frame: Channel<String>,
    state: &MetricsState,
) -> Result<(), AppError>
where
    I: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(io)
        .await
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });

    let mut response = sender
        .send_request(request)
        .await
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    let token = CancellationToken::new();
    state.keep(token.clone());

    tauri::async_runtime::spawn(async move {
        let _sender = sender;
        let mut frames = Frames::new();
        loop {
            tokio::select! {
                _ = token.cancelled() => return,
                next = response.frame() => {
                    let Some(Ok(frame)) = next else { break };
                    let Some(bytes) = frame.data_ref() else { continue };
                    for message in frames.push(&String::from_utf8_lossy(bytes)) {
                        if on_frame.send(message).is_err() {
                            return;
                        }
                    }
                }
            }
        }
        // Kết nối đứt: không có gì để phát riêng — frontend tự coi "không còn frame mới" là hết số,
        // và tự mở lại đúng lúc `active` quay về `true`.
    });

    Ok(())
}

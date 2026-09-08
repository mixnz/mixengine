//! Giữ `GET /logs/{subject}/{id}` mở và đẩy từng khung lên UI — mirror của `events.rs`, khác đúng
//! route và state (`LogsState`, không phải `MixEngineState`). `Frames` (parser SSE) dùng chung, không
//! viết lại. `subject` là `"service"` hoặc `"job"` — hai kiểu duy nhất `LogSubject` (phía MixEngine)
//! định nghĩa.

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use hyper_util::rt::TokioIo;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::sse::Frames;
use super::state::LogsState;
use super::transport::{self, Io};

/// Mở `GET /logs/{subject}/{id}?tail=N&follow=1` và chạy tới khi bị hủy hoặc kết nối đứt.
///
/// `subject` là `"service"` hoặc `"job"` — đúng hai đoạn route `LogSubject` (bindings đã vendor) nói
/// tới, không có đoạn thứ ba. Route tự nói loại nào, nên không cần đoán một job id có phải tên
/// service hay không.
pub async fn stream_logs(
    subject: &str,
    id: String,
    tail: u32,
    follow: bool,
    on_line: Channel<String>,
    state: &LogsState,
) -> Result<(), AppError> {
    let io = transport::connect().await?;

    let uri = format!(
        "/logs/{subject}/{id}?tail={tail}&follow={}",
        if follow { 1 } else { 0 }
    );
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header("host", "mixengine")
        .header("accept", "text/event-stream")
        .body(Full::new(Bytes::new()))
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    match io {
        #[cfg(windows)]
        Io::Pipe(pipe) => open(TokioIo::new(pipe), request, on_line, state).await,
        #[cfg(not(windows))]
        Io::Socket(socket) => open(TokioIo::new(socket), request, on_line, state).await,
    }
}

async fn open<I>(
    io: TokioIo<I>,
    request: Request<Full<Bytes>>,
    on_line: Channel<String>,
    state: &LogsState,
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
                        if on_line.send(message).is_err() {
                            return;
                        }
                    }
                }
            }
        }
        // Kết nối đứt: khác `/events`, không có "resync" cho log — một tab Logs mở lại tự gửi lại
        // `tail`/`follow` từ đầu, đó đã là "đọc lại" của luồng này.
    });

    Ok(())
}

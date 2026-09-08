//! Giữ `GET /events` mở và đẩy từng message lên UI.
//!
//! **Chỗ này không diễn giải gì** — nó chở JSON thô. Sự kiện của MixEngine internally tagged, và
//! một biến thể sinh ra ở phiên bản sau phải tới được một MixDB cũ như một object bỏ qua được,
//! chứ không phải như một lỗi parse. Việc hiểu payload là của frontend.
//!
//! **Sự kiện là best-effort và không bao giờ là đường duy nhất biết trạng thái.** Hai thứ frontend
//! phải xử đều đi qua đây dưới dạng một message: `{"type":"resync","missed":N}` khi bus bên kia
//! tràn, và [`DISCONNECTED`] khi kết nối đứt. Cả hai đều có nghĩa là "đọc lại `*.list`".

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use hyper_util::rt::TokioIo;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::sse::Frames;
use super::state::MixEngineState;
use super::transport::{self, Io};

/// Message MixDB tự phát khi stream đứt. Tên có tiền tố `mixdb_` để không bao giờ đụng một `type`
/// của MixEngine, kể cả một cái thêm vào ở phiên bản sau.
pub const DISCONNECTED: &str = r#"{"type":"mixdb_disconnected"}"#;

/// Mở stream và chạy tới khi bị hủy hoặc kết nối đứt.
///
/// Trả về ngay khi stream đã mở; phần đọc chạy trên một task riêng.
pub async fn stream_events(
    on_event: Channel<String>,
    state: &MixEngineState,
) -> Result<(), AppError> {
    let io = transport::connect().await?;

    let request = Request::builder()
        .method("GET")
        .uri("/events")
        .header("host", "mixengine")
        .header("accept", "text/event-stream")
        .body(Full::new(Bytes::new()))
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    match io {
        #[cfg(windows)]
        Io::Pipe(pipe) => open(TokioIo::new(pipe), request, on_event, state).await,
        #[cfg(not(windows))]
        Io::Socket(socket) => open(TokioIo::new(socket), request, on_event, state).await,
    }
}

/// Bắt tay, gửi, rồi giao phần đọc cho một task.
async fn open<I>(
    io: TokioIo<I>,
    request: Request<Full<Bytes>>,
    on_event: Channel<String>,
    state: &MixEngineState,
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

    // Chỉ giữ token sau khi stream đã mở được: hủy cái đang chạy rồi mới phát hiện cái mới không
    // mở nổi sẽ để người dùng không còn stream nào cả.
    let token = CancellationToken::new();
    state.keep(token.clone());

    tauri::async_runtime::spawn(async move {
        // `sender` phải sống cùng task này: thả nó ra là đóng kết nối mà body đang chảy trên đó.
        let _sender = sender;
        let mut frames = Frames::new();
        loop {
            tokio::select! {
                _ = token.cancelled() => return,
                next = response.frame() => {
                    let Some(Ok(frame)) = next else { break };
                    let Some(bytes) = frame.data_ref() else { continue };
                    for message in frames.push(&String::from_utf8_lossy(bytes)) {
                        if on_event.send(message).is_err() {
                            return;
                        }
                    }
                }
            }
        }
        // Kết nối đứt là một tin, không phải im lặng: frontend đọc lại `*.list` khi thấy nó.
        let _ = on_event.send(DISCONNECTED.to_string());
    });

    Ok(())
}

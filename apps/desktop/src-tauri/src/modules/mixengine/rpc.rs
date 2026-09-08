//! Một call JSON-RPC 2.0 tới `POST /rpc`, và những gì đi ra khi nó hỏng.
//!
//! **HTTP status nói về phong bì; lỗi JSON-RPC nói về cuộc gọi.** Một method thất bại là `200`
//! mang member `error` — request đã tới, đã parse được, đã được trả lời. Các status thật sự xuất
//! hiện đều là chuyện phong bì: `400` body không đọc được, `404` route không có, `405` kèm
//! `Allow`, `413` quá 1 MiB.
//!
//! **Rẽ nhánh theo `error.data.code`, không bao giờ theo câu chữ.** Tập mã đóng của MixEngine:
//! `not_found · already_exists · invalid_argument · conflict · precondition_failed · port_in_use ·
//! privileged_required · unsupported_platform · dependency_missing · process_failed · io ·
//! internal`. `message` không dịch: đó là daemon nói, và là chuỗi người ta tra cứu được — cùng
//! luật `error.rs` đã đặt cho message của driver.

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use hyper_util::rt::TokioIo;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::error::AppError;

use super::transport::{self, Io};

/// Gọi một method và giải kết quả của nó.
pub async fn call<T: DeserializeOwned>(method: &str, params: Value) -> Result<T, AppError> {
    let body = request(
        "POST",
        "/rpc",
        Some(json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })),
    )
    .await?;

    let answer: Value =
        serde_json::from_slice(&body).map_err(|e| err!("error.mixengineProtocol", message = e))?;

    if let Some(error) = map_rpc_error(&answer) {
        return Err(error);
    }

    let result = answer
        .get("result")
        .cloned()
        .ok_or_else(|| err!("error.mixengineProtocol", message = "no result member"))?;

    serde_json::from_value(result).map_err(|e| err!("error.mixengineProtocol", message = e))
}

/// Member `error` của một answer, thành `AppError`. `None` khi answer là một kết quả.
pub fn map_rpc_error(body: &Value) -> Option<AppError> {
    let error = body.get("error")?;
    let data = error.get("data");
    let code = data
        .and_then(|data| data.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("internal");
    let message = error.get("message").and_then(Value::as_str).unwrap_or("");

    let mut mapped = err!("error.mixengineRefused", code = code, message = message);
    // Vắng mặt chứ không rỗng: UI phân biệt được "không có gợi ý" với "gợi ý rỗng".
    if let Some(hint) = data.and_then(|data| data.get("hint")).and_then(Value::as_str) {
        mapped = mapped.with("hint", hint);
    }
    Some(mapped)
}

/// Một request HTTP/1.1 trên transport cục bộ; trả về body thô.
///
/// Mở kết nối cho mỗi call rồi đóng. Trên socket cục bộ chi phí bắt tay là micro giây, và đổi lại
/// không phải nuôi pool và không có kết nối chết nào phải phát hiện.
pub async fn request(verb: &str, path: &str, body: Option<Value>) -> Result<Vec<u8>, AppError> {
    let io = transport::connect().await?;
    let payload = body.map(|value| value.to_string()).unwrap_or_default();

    let outgoing = Request::builder()
        .method(verb)
        .uri(path)
        // Một request HTTP/1.1 cần `Host`, và daemon không quan tâm nó nói gì: không có tên nào
        // để phân giải ở đầu kia một socket.
        .header("host", "mixengine")
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(payload)))
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    // `_sender` phải sống tới khi body đọc xong: thả nó ra là đóng kết nối, và body vẫn đang chảy
    // trên đó. Tên có gạch dưới chứ không phải `_` trần — `_` thả ngay tại chỗ.
    let (_sender, response) = match io {
        #[cfg(windows)]
        Io::Pipe(pipe) => send(TokioIo::new(pipe), outgoing).await?,
        #[cfg(not(windows))]
        Io::Socket(socket) => send(TokioIo::new(socket), outgoing).await?,
    };

    let status = response.status();
    let collected = response
        .into_body()
        .collect()
        .await
        .map_err(|e| err!("error.mixengineProtocol", message = e))?
        .to_bytes();

    // 200 mang `error` vẫn là một call thất bại, và nó được xử ở `call`. Chỉ status ngoài dải
    // thành công mới là chuyện phong bì.
    if !status.is_success() {
        return Err(err!(
            "error.mixengineProtocol",
            message = format!("HTTP {status}")
        ));
    }
    Ok(collected.to_vec())
}

/// Bắt tay HTTP/1.1 trên một IO đã mở và gửi một request.
///
/// Tách ra để hai nhánh `#[cfg]` ở trên không phải chép cùng một khối hai lần với hai kiểu IO khác
/// nhau — generic làm việc đó, `#[cfg]` chỉ chọn kiểu.
type Sent = (
    hyper::client::conn::http1::SendRequest<Full<Bytes>>,
    hyper::Response<hyper::body::Incoming>,
);

async fn send<I>(io: TokioIo<I>, request: Request<Full<Bytes>>) -> Result<Sent, AppError>
where
    I: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(io)
        .await
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    // Kết nối phải được bơm trong lúc request đang bay; nó kết thúc khi `sender` bị thả.
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });

    let response = sender
        .send_request(request)
        .await
        .map_err(|e| err!("error.mixengineProtocol", message = e))?;

    Ok((sender, response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Một method thất bại là HTTP 200 mang member `error`. Cái phải đi ra là `data.code` — mã ổn
    /// định — chứ không phải câu chữ, và `hint` là thứ UI vẽ thành hành động gợi ý.
    #[test]
    fn a_refusal_carries_the_stable_code_and_the_hint() {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {
                "code": -32000,
                "message": "mariadb@main is not installed",
                "data": { "code": "not_found", "hint": "mix service create mariadb" }
            }
        });
        let error = map_rpc_error(&body).expect("an error member must map");
        assert_eq!(error.code, "error.mixengineRefused");
        assert_eq!(error.params.get("code"), Some(&"not_found".to_string()));
        assert_eq!(
            error.params.get("hint"),
            Some(&"mix service create mariadb".to_string())
        );
        assert_eq!(
            error.params.get("message"),
            Some(&"mariadb@main is not installed".to_string())
        );
    }

    /// Không có `hint` thì tham số vắng mặt, không phải một chuỗi rỗng.
    #[test]
    fn a_refusal_without_a_hint_carries_none() {
        let body = json!({
            "jsonrpc": "2.0", "id": 1,
            "error": { "code": -32601, "message": "no such method", "data": { "code": "not_found" } }
        });
        let error = map_rpc_error(&body).unwrap();
        assert_eq!(error.params.get("hint"), None);
    }

    /// Một `error` không có `data.code` vẫn phải ra một lỗi đọc được, không phải `None`.
    #[test]
    fn an_error_without_a_data_code_still_maps() {
        let body = json!({
            "jsonrpc": "2.0", "id": 1,
            "error": { "code": -32700, "message": "parse error" }
        });
        let error = map_rpc_error(&body).unwrap();
        assert_eq!(error.code, "error.mixengineRefused");
        assert_eq!(error.params.get("code"), Some(&"internal".to_string()));
    }

    /// Nói chuyện thật với một daemon đang chạy trên máy này.
    ///
    /// `#[ignore]` vì nó cần một MixEngine đã cài và đang chạy, thứ CI không có — chạy nó bằng
    /// `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture`. Đây là bài duy
    /// nhất chứng minh cả chuỗi: tên pipe suy ra đúng, chủ sở hữu khớp, HTTP/1.1 bắt tay được, và
    /// JSON-RPC trả về thứ đọc được. Không test thuần nào thay được nó.
    #[tokio::test]
    #[ignore]
    async fn a_live_daemon_answers_its_own_status() {
        let address = super::super::transport::current_address().expect("an address");
        println!("endpoint: {address}");

        let status: Value = call("daemon.status", json!({})).await.expect("daemon.status");
        println!("status: {status:#}");
        assert!(status.get("version").and_then(Value::as_str).is_some(), "{status}");
        assert!(status.get("home").and_then(Value::as_str).is_some(), "{status}");

        // `service.list` trả `{ services: [...] }` — một object, không phải mảng trần. Đây chính
        // là thứ chỉ một daemon thật nói ra, và là lý do frontend gõ kiểu theo `ServiceList`.
        let services: Value = call("service.list", json!({})).await.expect("service.list");
        println!("services: {services:#}");
        assert!(services.get("services").is_some_and(Value::is_array), "{services}");
    }

    /// Nhiều call liên tiếp, đúng cái làm hỏng bản trước.
    ///
    /// Trên Windows daemon giữ đúng một instance pipe chờ sẵn và chỉ dựng cái thay thế *sau khi*
    /// đã nhận một client. Một client dial liên tiếp — mà `presence()` rồi Dashboard làm ngay khi
    /// tab mở — rơi vào khe đó, và cả bước đọc owner lẫn bước mở đều trả `ERROR_PIPE_BUSY`. Bản
    /// trước báo "daemon không trả lời" ở một máy daemon đang chạy bình thường.
    #[tokio::test]
    #[ignore]
    async fn a_live_daemon_answers_several_calls_in_a_row() {
        for round in 0..5 {
            request("GET", "/health", None)
                .await
                .unwrap_or_else(|e| panic!("/health round {round}: {e:?}"));
            let _: Value = call("daemon.status", json!({}))
                .await
                .unwrap_or_else(|e| panic!("daemon.status round {round}: {e:?}"));
        }
        println!("five rounds of /health + daemon.status, no busy pipe");
    }

    /// Một answer thành công không phải một lỗi.
    #[test]
    fn a_result_is_not_an_error() {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "result": { "version": "0.1.0" } });
        assert!(map_rpc_error(&body).is_none());
    }
}

//! "Open" trên màn hình Services chi tiết — mở thẳng một tab `db` trong tiến trình đang chạy, không
//! đi qua `database.open` (vốn khởi động một process ngoài) và không đi qua OS.
//!
//! Lặp lại đúng ba bước Pha 0 đã dùng cho `mixdb://connect` — dựng một `Handoff`, giữ nó trong
//! `HandoffState`, gọi `crate::launch::request` — chỉ khác nguồn dựng `Handoff` là `database.client`
//! gọi thẳng ở đây, không phải một URL đọc từ dòng lệnh. Xem
//! `docs/superpowers/specs/2026-09-06-mixengine-runtimes-services-logs-design.md`, mục 4 và
//! Quyết định D2.

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::launch::{self, TabRequest};
use crate::modules::db::handoff::{Handoff, HandoffState};
use crate::modules::db::models::{ConnectionConfig, DbKind};
use crate::secrets::secrets_resolve_mixengine;

use super::rpc;

/// `DatabaseProtocol` bên MixEngine chỉ có ba giá trị; một giá trị lạ là daemon nói về một protocol
/// bindings này chưa biết, không phải lỗi lập trình — trả `unsupported_platform`-shaped error thay
/// vì panic.
fn db_kind_of(protocol: &str) -> Result<DbKind, AppError> {
    match protocol {
        "mysql" => Ok(DbKind::Mysql),
        "postgres" => Ok(DbKind::Postgres),
        "redis" => Ok(DbKind::Redis),
        other => Err(err!(
            "error.mixengineProtocol",
            message = format!("database.client answered an unknown protocol `{other}`")
        )),
    }
}

/// Mở một service database làm một tab `db` mới trong cùng tiến trình.
///
/// `database` là tên database cụ thể muốn mở vào, hoặc `None` để mở ở mức server. Không bao giờ
/// nhận hay chuyển tiếp mật khẩu ra ngoài hàm này — nó sống trong biến cục bộ `password` và chỉ đi
/// vào `Handoff` đang chờ `db` lấy.
#[tauri::command]
pub async fn mixengine_database_open_in_mixdb(
    app: AppHandle,
    handoffs: State<'_, HandoffState>,
    service: String,
    database: Option<String>,
) -> Result<(), AppError> {
    let report: Value = rpc::call("database.client", json!({ "service": service })).await?;

    let protocol = report
        .get("protocol")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            err!(
                "error.mixengineProtocol",
                message = "database.client answered with no protocol for a service this screen \
                           should not have offered Open for"
            )
        })?;
    let kind = db_kind_of(protocol)?;

    // `database.client` không mang port — nó là thứ `ServiceSummary` (từ `service.list`) khai, cùng
    // report `mixengine_services()` đã dùng, không phải một field của báo cáo này.
    let services: Value = rpc::call("service.list", json!({})).await?;
    let port = services
        .get("services")
        .and_then(Value::as_array)
        .and_then(|rows| rows.iter().find(|row| row.get("id").and_then(Value::as_str) == Some(service.as_str())))
        .and_then(|row| row.get("port"))
        .and_then(Value::as_u64)
        .and_then(|p| u16::try_from(p).ok());
    let port = port.ok_or_else(|| {
        err!(
            "error.mixengineProtocol",
            message = "this service's row has no usable port"
        )
    })?;

    let secret = report.get("secret").cloned();
    let (password, keyring_ref, username) = match &secret {
        Some(address) => {
            let key = address
                .get("key")
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| {
                    err!(
                        "error.mixengineProtocol",
                        message = "database.client answered a secret with no key"
                    )
                })?;
            let password = secrets_resolve_mixengine(key.clone()).await?;
            // `key` is `"<service-id>/<user>"` — the part after the last `/` is the account.
            let user = key.rsplit('/').next().map(str::to_string);
            (password, Some(key), user)
        }
        None => (None, None, None),
    };

    let config = ConnectionConfig {
        kind,
        host: "127.0.0.1".to_string(),
        port,
        username,
        password,
        database,
        uri: None,
        path: None,
        ssh: None,
        use_ssl: None,
    };

    let handoff = Handoff {
        config,
        label: service.clone(),
        keyring_ref,
    };
    let id = handoffs.keep(handoff);
    launch::request(
        &app,
        TabRequest {
            module_id: "db",
            state: json!({ "handoffId": id }),
        },
    );

    Ok(())
}

//! Các lệnh module này lộ ra cho frontend.
//!
//! Không có nghiệp vụ nào ở đây: mỗi lệnh là một call JSON-RPC hoặc một câu hỏi về trạng thái, và
//! nghiệp vụ ở lại phía daemon. Đó là luật `CLAUDE.md` bên MixEngine giữ cho mọi client của nó, và
//! là lý do màn hình bên này vẽ được từ dữ liệu thay vì tự suy ra.

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppError;

use super::state::MixEngineState;
use super::{events, health, rpc};

/// Daemon đang chạy, đang câm, chưa chạy, hay chưa được cài.
#[tauri::command]
pub async fn mixengine_presence() -> health::Presence {
    health::presence().await
}

/// Khởi động daemon. Trả về endpoint nó in ra khi đã sẵn sàng.
#[tauri::command]
pub async fn mixengine_start() -> Result<String, AppError> {
    health::start_daemon().await
}

/// Cả hai lệnh đọc dưới đây trả thẳng `Value`, không giải vào struct của riêng MixDB.
///
/// Rust không đọc field nào trong hai câu trả lời này — nó chuyển tiếp. Một struct ở đây sẽ là bản
/// chép tay thứ hai của một hợp đồng đã có bản sinh tự động ở `src/modules/mixengine/api/types/`,
/// và bản chép tay đầu tiên đã sai ngay: nó thiếu `last_started_at` và `last_exit_code`, nên
/// frontend gõ kiểu `ServiceSummary` sẽ nhận `undefined` cho field hợp đồng nói là có.
#[tauri::command]
pub async fn mixengine_status() -> Result<Value, AppError> {
    rpc::call("daemon.status", json!({})).await
}

#[tauri::command]
pub async fn mixengine_services() -> Result<Value, AppError> {
    rpc::call("service.list", json!({})).await
}

/// Method và params của một hành động trên service. Tách khỏi lệnh để có chỗ mà test: cái sai ở
/// đây không ra lỗi, nó ra một hành động đúng trên sai đối tượng.
///
/// **Field là `service`.** `ServiceTarget` — params dùng chung của cả ba method — khai
/// `service?: ServiceId | null` và nói rõ vắng mặt nghĩa là *mọi service đã khai*. Gửi `id` từng
/// làm mỗi lần bấm Start ở một hàng thành một lệnh start-tất-cả, không một câu lỗi nào.
///
/// **`wait: true`, dù doc của `ServiceTarget` viết "A GUI sends `false`."** Lời khuyên đó giả định
/// một GUI vẽ *hoàn toàn* từ stream. Dashboard bên này thì không: `act()` gọi `reload()` ngay khi
/// call trả về. Với `wait: false` call trả về tức thì, nên `reload()` đọc `service.list` **giữa
/// lúc kế hoạch đang chạy** và ghi đè trạng thái mà stream vừa áp vào bằng số liệu cũ hơn — hàng
/// nhảy về trạng thái cũ rồi mới tự sửa khi sự kiện kế tiếp tới.
///
/// Với `wait: true`, call trả về khi kế hoạch đã xong: `reload()` đọc được sự thật, và nhãn "đang
/// bật…" ở lại suốt thời gian đó thay vì tắt ngay lập tức. Chờ ở đây không làm đứng cửa sổ — nó là
/// `async`, chỉ mấy nút của đúng hàng đó bị khoá.
///
/// Đổi sang `false` chỉ đúng khi `act()` thôi tự `reload()` và để stream là đường duy nhất.
fn service_action_call(id: &str, action: &str) -> Result<(&'static str, Value), AppError> {
    let method = match action {
        "start" => "service.start",
        "stop" => "service.stop",
        "restart" => "service.restart",
        // Không phải lỗi của người dùng: frontend là chỗ duy nhất gọi lệnh này, nên một `action`
        // lạ là một lỗi lập trình và đi ra dưới dạng lỗi giao thức.
        other => {
            return Err(err!(
                "error.mixengineProtocol",
                message = format!("no service action `{other}`")
            ))
        }
    };
    Ok((method, json!({ "service": id, "wait": true })))
}

/// `start`, `stop` hoặc `restart` một service.
///
/// Ba method này là ngoại lệ duy nhất của MixEngine nhận `wait` thay vì trả về một job.
#[tauri::command]
pub async fn mixengine_service_action(id: String, action: String) -> Result<Value, AppError> {
    let (method, params) = service_action_call(&id, &action)?;
    rpc::call(method, params).await
}

/// Mở stream sự kiện. Mở lại là đóng cái đang mở.
#[tauri::command]
pub async fn mixengine_watch(
    on_event: Channel<String>,
    state: State<'_, MixEngineState>,
) -> Result<(), AppError> {
    events::stream_events(on_event, &state).await
}

/// Đóng stream. Gọi khi không có gì mở là vô hại — cleanup của một effect chạy hai lần trong
/// StrictMode.
#[tauri::command]
pub fn mixengine_unwatch(state: State<'_, MixEngineState>) {
    state.stop();
}

/// Mọi thao tác đang chờ quyền quản trị, kèm câu mô tả daemon tự viết cho từng cái.
///
/// `daemon.status` chỉ mang một con số (`ElevationSummary.pending`); danh sách thật ở đây. Một tab
/// mở ra khi đã có sẵn thao tác chờ không nhận `elevation_required` nào — sự kiện đó chỉ bắn lúc
/// hàng đợi đổi — nên đây là đường duy nhất thấy chúng.
#[tauri::command]
pub async fn mixengine_elevation_status() -> Result<Value, AppError> {
    rpc::call("elevation.status", json!({})).await
}

/// Cho phép cả lô thao tác đang chờ. Bật đúng một prompt của hệ điều hành.
#[tauri::command]
pub async fn mixengine_elevation_grant() -> Result<Value, AppError> {
    rpc::call("elevation.grant", json!({})).await
}

/// Bỏ cả lô đi. Từ chối là một kết cục API mô hình hóa được, không phải một lỗi.
#[tauri::command]
pub async fn mixengine_elevation_drop() -> Result<Value, AppError> {
    rpc::call("elevation.drop", json!({})).await
}

/// `project` lọc theo tên; bỏ trống thấy mọi site trong home.
#[tauri::command]
pub async fn mixengine_sites(project: Option<String>) -> Result<Value, AppError> {
    let params = match project {
        Some(name) => json!({ "project": { "name": name } }),
        None => json!({}),
    };
    rpc::call("site.list", params).await
}

/// Luôn tra theo domain — MixDB không dùng `SiteRef::Path`, chỉ CLI đứng trong thư mục mới cần nó.
#[tauri::command]
pub async fn mixengine_site(domain: String) -> Result<Value, AppError> {
    rpc::call("site.show", json!({ "site": { "domain": domain } })).await
}

/// `params` đã đúng hình `SiteCreate` từ frontend — không giải vào struct Rust riêng, đó sẽ là bản
/// chép tay thứ hai của một hợp đồng đã gõ đúng ở TypeScript (spec Pha 2, mục 5).
#[tauri::command]
pub async fn mixengine_site_create(params: Value) -> Result<Value, AppError> {
    rpc::call("site.create", params).await
}

/// `params` đúng hình `SiteUpdate`.
#[tauri::command]
pub async fn mixengine_site_update(params: Value) -> Result<Value, AppError> {
    rpc::call("site.update", params).await
}

/// `params` đúng hình `SiteShare`.
#[tauri::command]
pub async fn mixengine_site_share(params: Value) -> Result<Value, AppError> {
    rpc::call("site.share", params).await
}

#[tauri::command]
pub async fn mixengine_site_unshare(domain: String) -> Result<Value, AppError> {
    rpc::call("site.unshare", json!({ "site": { "domain": domain } })).await
}

/// Chỉ để dựng dropdown project ở dialog tạo site — không phải một màn hình Projects.
#[tauri::command]
pub async fn mixengine_projects() -> Result<Value, AppError> {
    rpc::call("project.list", json!({})).await
}

/// Tra một project theo tên, kèm pin **hiệu lực** (file thắng row).
#[tauri::command]
pub async fn mixengine_project_show(name: String) -> Result<Value, AppError> {
    rpc::call("project.show", json!({ "project": { "name": name } })).await
}

/// `params` đúng hình `ProjectCreate` từ frontend — không giải vào struct Rust riêng, cùng lý do
/// `mixengine_site_create` đã theo (Pha 2 spec, mục 5).
#[tauri::command]
pub async fn mixengine_project_create(params: Value) -> Result<Value, AppError> {
    rpc::call("project.create", params).await
}

/// `params` đúng hình `ProjectUpdate`. `pins` thay thế toàn bộ — frontend gửi lại mọi pin hiện có
/// cộng thay đổi, không gửi mỗi pin mới.
#[tauri::command]
pub async fn mixengine_project_update(params: Value) -> Result<Value, AppError> {
    rpc::call("project.update", params).await
}

/// Xoá đăng ký — thư mục và `mixengine.toml` được giữ nguyên (`ProjectRemoval.root_kept`/
/// `manifest_kept`), UI phải nói rõ điều đó ở hộp thoại xác nhận.
#[tauri::command]
pub async fn mixengine_project_delete(name: String) -> Result<Value, AppError> {
    rpc::call("project.delete", json!({ "project": { "name": name } })).await
}

/// `domain.dns_status` là cả `domain.list` lẫn chẩn đoán một tên — bỏ trống `domain` thấy mọi tên.
#[tauri::command]
pub async fn mixengine_domains(domain: Option<String>) -> Result<Value, AppError> {
    rpc::call("domain.dns_status", json!({ "domain": domain })).await
}

#[tauri::command]
pub async fn mixengine_domain_add(params: Value) -> Result<Value, AppError> {
    rpc::call("domain.add", params).await
}

#[tauri::command]
pub async fn mixengine_domain_remove(domain: String) -> Result<Value, AppError> {
    rpc::call("domain.remove", json!({ "domain": domain })).await
}

#[tauri::command]
pub async fn mixengine_ca_status() -> Result<Value, AppError> {
    rpc::call("cert.ca_status", json!({})).await
}

/// Sửa nửa "trình duyệt" của CA. `params` đúng hình `DoctorRepair { grant }` — giả định ban đầu
/// rằng sửa NSS database không cần quyền quản trị đã sai trên máy thật, nên gọi lại đúng luồng hai
/// bước T64 giống `mixengine_doctor_repair`/`elevation.*` ở Dashboard, thay vì hard-code `grant: true`.
#[tauri::command]
pub async fn mixengine_ca_repair(params: Value) -> Result<Value, AppError> {
    rpc::call("daemon.doctor_repair", params).await
}

/// Bỏ trống `domain` để cấp cho mọi site có khai HTTPS — cùng một call vẽ bảng lẫn cấp lại.
#[tauri::command]
pub async fn mixengine_certs(domain: Option<String>) -> Result<Value, AppError> {
    let site = domain.map(|d| json!({ "domain": d }));
    rpc::call("cert.issue", json!({ "site": site })).await
}

/// `filter` đúng hình `RuntimeFilter` — bỏ trống (`{}`) thấy cả bốn kind.
#[tauri::command]
pub async fn mixengine_runtime_list_installed(filter: Value) -> Result<Value, AppError> {
    rpc::call("runtime.list_installed", filter).await
}

/// `filter` đúng hình `RuntimeFilter`. `RuntimeCatalogue.stale` phải được frontend vẽ ra, không bỏ
/// qua — xem D3.
#[tauri::command]
pub async fn mixengine_runtime_list_available(filter: Value) -> Result<Value, AppError> {
    rpc::call("runtime.list_available", filter).await
}

/// `target` đúng hình `RuntimeTarget { kind, version }`. Trả `JobSummary` — id của nó là thứ frontend
/// theo dõi qua stream `/events` đã mở sẵn.
#[tauri::command]
pub async fn mixengine_runtime_install(target: Value) -> Result<Value, AppError> {
    rpc::call("runtime.install", target).await
}

/// `params` đúng hình `RuntimeUninstall { kind, version, force? }`.
#[tauri::command]
pub async fn mixengine_runtime_uninstall(params: Value) -> Result<Value, AppError> {
    rpc::call("runtime.uninstall", params).await
}

/// `target` đúng hình `RuntimeTarget`.
#[tauri::command]
pub async fn mixengine_runtime_set_default(target: Value) -> Result<Value, AppError> {
    rpc::call("runtime.set_default", target).await
}

/// `target` đúng hình `RuntimeTarget` — một bản PHP, trả `RuntimeExtension[]`.
#[tauri::command]
pub async fn mixengine_runtime_list_extensions(target: Value) -> Result<Value, AppError> {
    rpc::call("runtime.list_extensions", target).await
}

/// `choice` đúng hình `ExtensionChoice { kind, version, name, enabled }`. Trả `ExtensionChange
/// { extension, pool }` — `pool` là thứ frontend đọc để quyết định banner nào hiện.
#[tauri::command]
pub async fn mixengine_runtime_set_extension(choice: Value) -> Result<Value, AppError> {
    rpc::call("runtime.set_extension", choice).await
}

/// `filter` đúng hình `PackageFilter { package? }`.
#[tauri::command]
pub async fn mixengine_package_list(filter: Value) -> Result<Value, AppError> {
    rpc::call("package.list", filter).await
}

/// `filter` đúng hình `PackageFilter`. `PackageCatalogue.stale` phải được vẽ, cùng component với
/// `RuntimeCatalogue.stale` — D3.
#[tauri::command]
pub async fn mixengine_package_list_available(filter: Value) -> Result<Value, AppError> {
    rpc::call("package.list_available", filter).await
}

/// `target` đúng hình `PackageTarget { package, version }`. Trả `JobSummary`, cùng cách theo dõi qua
/// stream như `runtime.install`.
#[tauri::command]
pub async fn mixengine_package_install(target: Value) -> Result<Value, AppError> {
    rpc::call("package.install", target).await
}

/// `target` đúng hình `PackageTarget`. **Không có `force`** — refuse vì `services` không rỗng là
/// chốt, không có tham số nào vượt qua nó (D6).
#[tauri::command]
pub async fn mixengine_package_uninstall(target: Value) -> Result<Value, AppError> {
    rpc::call("package.uninstall", target).await
}

/// `service` là `ServiceId` trần (một chuỗi).
#[tauri::command]
pub async fn mixengine_service_limits(service: String) -> Result<Value, AppError> {
    rpc::call("service.limits", json!({ "service": service })).await
}

/// `params` đúng hình `ServiceLimitsSet { service, limits }` — `limits` phải là toàn bộ
/// `ResourceLimits`, không phải một phần: gửi thiếu field nào là xoá field đó, đúng như
/// `ServiceLimitsSet`'s doc đã ghi. Frontend chịu trách nhiệm gửi đủ.
#[tauri::command]
pub async fn mixengine_service_set_limits(params: Value) -> Result<Value, AppError> {
    rpc::call("service.set_limits", params).await
}

/// Đọc chính sách idle hiện tại. **Chưa có type TypeScript đã vendor cho câu trả lời này** — xác
/// nhận hình dạng thật khi chạy với daemon thật (Task 8).
#[tauri::command]
pub async fn mixengine_service_idle(service: String) -> Result<Value, AppError> {
    rpc::call("service.idle", json!({ "service": service })).await
}

/// `params` đúng hình `ServiceIdleSet { service, minutes? }` — ba trạng thái: vắng mặt (theo
/// recipe), `0` (tắt hẳn), `n` (n phút).
#[tauri::command]
pub async fn mixengine_service_set_idle(params: Value) -> Result<Value, AppError> {
    rpc::call("service.set_idle", params).await
}

/// `service.set_front_end` — T97 / ADR 0026. `params` đúng hình `FrontEndSwitch { server, version?,
/// grant }`; trả một `JobSummary` (dừng server cũ, dựng server mới là một job), kết quả job là
/// `FrontEndReport`. Không có method đọc riêng: server đang active đọc từ `ServiceSummary.role`.
#[tauri::command]
pub async fn mixengine_service_set_front_end(params: Value) -> Result<Value, AppError> {
    rpc::call("service.set_front_end", params).await
}

/// `params` đúng hình `ServiceCreate { id, version, port?, bind_addr?, data_dir?, autostart?,
/// overrides? }` — không giải vào struct Rust riêng, cùng lý do `mixengine_site_create` đã theo.
/// Trả `ServiceCreation { service, moved_from? }`: `moved_from` là câu chỉ đúng ở khoảnh khắc này,
/// nên nó ở đây chứ không ở `service.list`.
#[tauri::command]
pub async fn mixengine_service_create(params: Value) -> Result<Value, AppError> {
    rpc::call("service.create", params).await
}

/// `params` đúng hình `ServiceDelete { service, force? }`. Trả `ServiceRemoval { removed,
/// data_kept? }` — `force` chỉ vượt qua một site đang khai service này, không vượt qua một tiến
/// trình đang chạy; thư mục dữ liệu không bao giờ bị xoá, chỉ được nêu tên nếu có.
#[tauri::command]
pub async fn mixengine_service_delete(params: Value) -> Result<Value, AppError> {
    rpc::call("service.delete", params).await
}

/// `params` đúng hình `DatabaseCreate { service, database, user? }`.
#[tauri::command]
pub async fn mixengine_database_create(params: Value) -> Result<Value, AppError> {
    rpc::call("database.create", params).await
}

/// `service` là `ServiceId` trần. Đọc-only, không khởi động gì — dùng để vẽ affordance "Open" trước
/// khi biết có bấm được không.
#[tauri::command]
pub async fn mixengine_database_client(service: String) -> Result<Value, AppError> {
    rpc::call("database.client", json!({ "service": service })).await
}

/// Mở stream log của một service. Mở lại (một service khác, hay cùng service với `tail` khác) đóng
/// cái đang mở — đúng luật `LogsState::keep` đã theo cho `MixEngineState`.
#[tauri::command]
pub async fn mixengine_logs_watch(
    service: String,
    tail: u32,
    follow: bool,
    on_line: Channel<String>,
    state: State<'_, super::state::LogsState>,
) -> Result<(), AppError> {
    super::logs::stream_logs("service", service, tail, follow, on_line, &state).await
}

/// Output của một job (`GET /logs/job/{id}`) — cùng `LogsState`, cùng luật "mở lại đóng cái đang mở"
/// service log đã theo. Dùng cho bước `run_scaffold` của `blueprint.apply`: đây là chỗ duy nhất
/// output thật của lệnh scaffold lộ ra, `BlueprintApplied` (kết quả job) không mang nó.
#[tauri::command]
pub async fn mixengine_job_logs_watch(
    job: i64,
    tail: u32,
    follow: bool,
    on_line: Channel<String>,
    state: State<'_, super::state::LogsState>,
) -> Result<(), AppError> {
    super::logs::stream_logs("job", job.to_string(), tail, follow, on_line, &state).await
}

/// Đóng stream log đang mở. Gọi khi không có gì mở là vô hại.
#[tauri::command]
pub fn mixengine_logs_unwatch(state: State<'_, super::state::LogsState>) {
    state.stop();
}

/// Mở `GET /metrics`. **Mở kết nối này chính là subscribe** — daemon lấy mẫu 1 Hz trong lúc còn mở,
/// 1 lần/phút khi không ai giữ. Gọi từ Dashboard đúng lúc `active` chuyển `true`, đóng lại đúng lúc
/// nó chuyển `false` — không mở suốt đời app như `mixengine_watch`/`/events`, xem `MetricsState`.
#[tauri::command]
pub async fn mixengine_metrics_watch(
    on_frame: Channel<String>,
    state: State<'_, super::state::MetricsState>,
) -> Result<(), AppError> {
    super::metrics::stream_metrics(on_frame, &state).await
}

/// Đóng stream `/metrics` đang mở. Gọi khi không có gì mở là vô hại.
#[tauri::command]
pub fn mixengine_metrics_unwatch(state: State<'_, super::state::MetricsState>) {
    state.stop();
}

/// `daemon.disk_usage` — `refresh: false` đọc bản daemon giữ (tới một phút), `true` đi bộ đĩa lại.
#[tauri::command]
pub async fn mixengine_disk_usage(refresh: bool) -> Result<Value, AppError> {
    rpc::call("daemon.disk_usage", json!({ "refresh": refresh })).await
}

/// `daemon.cleanup` — trả một `JobSummary`, tiến độ theo dõi qua `/events` chung như mọi job khác,
/// không có hạ tầng riêng.
#[tauri::command]
pub async fn mixengine_cleanup(params: Value) -> Result<Value, AppError> {
    rpc::call("daemon.cleanup", params).await
}

/// `metrics.history` — đọc thường, không cần stream. Màn Metrics dựng trên đúng call này.
#[tauri::command]
pub async fn mixengine_metrics_history(params: Value) -> Result<Value, AppError> {
    rpc::call("metrics.history", params).await
}

/// `blueprint.list` — mọi blueprint home này giữ, theo thứ tự slug.
#[tauri::command]
pub async fn mixengine_blueprints() -> Result<Value, AppError> {
    rpc::call("blueprint.list", json!({})).await
}

/// `params` đúng hình `BlueprintCapture { project: ProjectRef, name, description?, overwrite }`.
#[tauri::command]
pub async fn mixengine_blueprint_capture(params: Value) -> Result<Value, AppError> {
    rpc::call("blueprint.capture", params).await
}

/// `params` đúng hình `BlueprintImport { path, signature?, name?, overwrite }`. Không bao giờ trả
/// lỗi vì chữ ký sai — một chữ ký thiếu hoặc sai chỉ đổi `BlueprintSummary.trusted`/`signature` của
/// kết quả, không chặn việc nhập.
#[tauri::command]
pub async fn mixengine_blueprint_import(params: Value) -> Result<Value, AppError> {
    rpc::call("blueprint.import", params).await
}

/// `params` đúng hình `BlueprintApply { blueprint, project, root, dry_run, answers?, scaffold? }` —
/// một method, gọi hai lượt: `dry_run: true` trả `{ outcome: "planned", plan }`, `dry_run: false` trả
/// `{ outcome: "started", job }`.
#[tauri::command]
pub async fn mixengine_blueprint_apply(params: Value) -> Result<Value, AppError> {
    rpc::call("blueprint.apply", params).await
}

/// `job.status` — chưa có command nào gọi tới namespace `job.*` trong file này trước đây. Cần đúng
/// một lần: đọc `BlueprintApplied` sau khi job đã biến khỏi danh sách job đang chạy trên stream
/// (`job_finished` xoá hàng, không giữ payload — xem `daemonState.applyJob`).
#[tauri::command]
pub async fn mixengine_job_status(job: i64) -> Result<Value, AppError> {
    rpc::call("job.status", json!({ "job": job })).await
}

/// `extension.list` — mọi extension home này đã cài. Tên Tauri command theo đúng khuôn
/// `mixengine_runtime_list_installed`/`mixengine_package_list` đã dùng cho cặp installed/available.
#[tauri::command]
pub async fn mixengine_extension_list_installed() -> Result<Value, AppError> {
    rpc::call("extension.list", json!({})).await
}

/// `extension.available` — registry publish gì, kèm `unreadable`/`stale`. **Không phải
/// `extension.registry_list`** — tên đó không tồn tại, dù roadmap T4.4 ghi vậy.
#[tauri::command]
pub async fn mixengine_extension_list_available() -> Result<Value, AppError> {
    rpc::call("extension.available", json!({})).await
}

/// `params` đúng hình `ExtensionPlanRequest { source: ExtensionOrigin }`. Đây là bước duy nhất trước
/// khi cài — không gọi `extension.inspect` (Quyết định D2, spec).
#[tauri::command]
pub async fn mixengine_extension_plan(params: Value) -> Result<Value, AppError> {
    rpc::call("extension.plan", params).await
}

/// `params` đúng hình `ExtensionInstall { source, consent }` — `consent` phải trích nguyên từ
/// `ExtensionPlan` vừa nhận (Quyết định D3, spec), không phải build lại từ input người dùng.
#[tauri::command]
pub async fn mixengine_extension_install(params: Value) -> Result<Value, AppError> {
    rpc::call("extension.install", params).await
}

/// `params` đúng hình `ExtensionUninstall { id, delete_data }`.
#[tauri::command]
pub async fn mixengine_extension_uninstall(params: Value) -> Result<Value, AppError> {
    rpc::call("extension.uninstall", params).await
}

/// `id` là `ExtensionId` trần. Gọi qua `extension.*`, không phải `service.*` — hai namespace khác
/// nhau dù giá trị id trùng nhau cho một extension kiểu `service` (spec, mục Extensions/Gỡ, Start,
/// Stop).
#[tauri::command]
pub async fn mixengine_extension_start(id: String) -> Result<Value, AppError> {
    rpc::call("extension.start", json!({ "id": id })).await
}

#[tauri::command]
pub async fn mixengine_extension_stop(id: String) -> Result<Value, AppError> {
    rpc::call("extension.stop", json!({ "id": id })).await
}

/// `autostart.status` — đọc mechanism/location/enabled/for_this_home hiện tại, không tham số.
#[tauri::command]
pub async fn mixengine_autostart_status() -> Result<Value, AppError> {
    rpc::call("autostart.status", json!({})).await
}

#[tauri::command]
pub async fn mixengine_autostart_enable() -> Result<Value, AppError> {
    rpc::call("autostart.enable", json!({})).await
}

#[tauri::command]
pub async fn mixengine_autostart_disable() -> Result<Value, AppError> {
    rpc::call("autostart.disable", json!({})).await
}

/// `update.status` — đọc rẻ, không ra mạng.
#[tauri::command]
pub async fn mixengine_update_status() -> Result<Value, AppError> {
    rpc::call("update.status", json!({})).await
}

/// `params` đúng hình `UpdateCheck { force }` — ra mạng.
#[tauri::command]
pub async fn mixengine_update_check(params: Value) -> Result<Value, AppError> {
    rpc::call("update.check", params).await
}

/// `params` đúng hình `UpdateDecide { version, decision }`.
#[tauri::command]
pub async fn mixengine_update_decide(params: Value) -> Result<Value, AppError> {
    rpc::call("update.decide", params).await
}

/// `params` đúng hình `UpdateApply { version }`. Daemon tự thoát ngay sau khi trả lời — cùng luật
/// `daemon.shutdown` Pha 1 đã theo (T1.5: không trả lời là một trạng thái đọc được, không phải lỗi).
#[tauri::command]
pub async fn mixengine_update_apply(params: Value) -> Result<Value, AppError> {
    rpc::call("update.apply", params).await
}

/// `daemon.doctor` — đọc thuần, không tham số, không thể tự bật elevation.
#[tauri::command]
pub async fn mixengine_doctor() -> Result<Value, AppError> {
    rpc::call("daemon.doctor", json!({})).await
}

/// `params` đúng hình `DoctorRepair { grant }` — tách khỏi `mixengine_ca_repair` đã có: cái đó
/// hard-code `grant: true` riêng cho luồng sửa CA (Pha 2), cái này nhận `grant` từ Settings, theo
/// đúng luồng hai lượt T64 (enqueue trước, `elevation.grant` sau khi đã hiện hàng đợi).
#[tauri::command]
pub async fn mixengine_doctor_repair(params: Value) -> Result<Value, AppError> {
    rpc::call("daemon.doctor_repair", params).await
}

/// `params` đúng hình `UninstallQuery { keep_home, grant: false }` — đọc thuần (T87 rule), gọi
/// trước và luôn luôn trước `mixengine_uninstall`.
#[tauri::command]
pub async fn mixengine_uninstall_plan(params: Value) -> Result<Value, AppError> {
    rpc::call("daemon.uninstall_plan", params).await
}

/// `params` đúng hình `UninstallQuery { keep_home, grant: true }` — một job tự bật đúng một prompt,
/// và trừ khi `keep_home` thì daemon tự thoát sau khi job ghi xong kết quả.
#[tauri::command]
pub async fn mixengine_uninstall(params: Value) -> Result<Value, AppError> {
    rpc::call("daemon.uninstall", params).await
}

/// `daemon.bundle` — không tham số thật (`DiagnosticsBundle` rỗng), gom một archive và trả đường
/// dẫn của nó.
#[tauri::command]
pub async fn mixengine_bundle() -> Result<Value, AppError> {
    rpc::call("daemon.bundle", json!({})).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Tên field là `service`, không phải `id`.** `ServiceTarget` — params dùng chung của
    /// `service.start/stop/restart` — nói rõ trường đó vắng mặt nghĩa là *mọi service đã khai*.
    /// Nên gõ nhầm tên khoá không ra một lỗi: nó ra một lệnh bấm-tất-cả, im lặng, ở mọi hàng.
    #[test]
    fn an_action_names_the_service_it_is_about() {
        let (method, params) = service_action_call("mariadb@main", "start").expect("a known action");
        assert_eq!(method, "service.start");
        assert_eq!(params["service"], "mariadb@main");
        assert!(
            params.get("id").is_none(),
            "`id` is not a field of ServiceTarget; sending it leaves `service` absent"
        );
    }

    /// `wait: true`: `act()` bên Dashboard `reload()` ngay khi call trả về, nên một call trả về
    /// trước khi kế hoạch xong sẽ đọc `service.list` giữa chừng và ghi đè trạng thái stream vừa
    /// áp vào bằng số cũ hơn. Xem doc của `service_action_call` cho điều kiện để đổi lại `false`.
    #[test]
    fn the_call_waits_because_the_screen_reloads_after_it() {
        let (_, params) = service_action_call("caddy", "stop").expect("a known action");
        assert_eq!(params["wait"], true);
    }

    #[test]
    fn each_action_maps_to_its_own_method() {
        for (action, method) in [
            ("start", "service.start"),
            ("stop", "service.stop"),
            ("restart", "service.restart"),
        ] {
            let (mapped, _) = service_action_call("caddy", action).expect("a known action");
            assert_eq!(mapped, method);
        }
    }

    /// Frontend là chỗ duy nhất gọi lệnh này, nên một `action` lạ là lỗi lập trình — và nó phải
    /// đi ra như một lỗi, không phải rơi vào một method đoán bừa.
    #[test]
    fn an_unknown_action_is_refused_rather_than_guessed() {
        assert!(service_action_call("caddy", "pause").is_err());
    }
}

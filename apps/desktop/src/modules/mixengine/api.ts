import { Channel, invoke } from "@tauri-apps/api/core";

import type { DaemonStatus } from "./api/types/DaemonStatus";
import type { ElevationStatus } from "./api/types/ElevationStatus";
import type { ServiceList } from "./api/types/ServiceList";
import type { SiteCreate } from "./api/types/SiteCreate";
import type { SiteCreation } from "./api/types/SiteCreation";
import type { SiteDetail } from "./api/types/SiteDetail";
import type { SiteList } from "./api/types/SiteList";
import type { SiteShare } from "./api/types/SiteShare";
import type { SiteSharing } from "./api/types/SiteSharing";
import type { SiteUpdate } from "./api/types/SiteUpdate";
import type { ProjectList } from "./api/types/ProjectList";
import type { ProjectDetail } from "./api/types/ProjectDetail";
import type { ProjectCreate } from "./api/types/ProjectCreate";
import type { ProjectUpdate } from "./api/types/ProjectUpdate";
import type { ProjectRemoval } from "./api/types/ProjectRemoval";
import type { ProjectSummary } from "./api/types/ProjectSummary";
import type { RuntimeKind } from "./api/types/RuntimeKind";
import type { RuntimeList } from "./api/types/RuntimeList";
import type { RuntimeCatalogue } from "./api/types/RuntimeCatalogue";
import type { RuntimeTarget } from "./api/types/RuntimeTarget";
import type { RuntimeUninstall } from "./api/types/RuntimeUninstall";
import type { RuntimeRemoval } from "./api/types/RuntimeRemoval";
import type { RuntimeSummary } from "./api/types/RuntimeSummary";
import type { RuntimeExtension } from "./api/types/RuntimeExtension";
import type { ExtensionChoice } from "./api/types/ExtensionChoice";
import type { ExtensionChange } from "./api/types/ExtensionChange";
import type { JobSummary } from "./api/types/JobSummary";
import type { DiskUsage } from "./api/types/DiskUsage";
import type { CleanupQuery } from "./api/types/CleanupQuery";
import type { MetricsHistory } from "./api/types/MetricsHistory";
import type { MetricsHistoryQuery } from "./api/types/MetricsHistoryQuery";
import type { PackageList } from "./api/types/PackageList";
import type { PackageCatalogue } from "./api/types/PackageCatalogue";
import type { PackageTarget } from "./api/types/PackageTarget";
import type { PackageRemoval } from "./api/types/PackageRemoval";
import type { ServiceLimitsReport } from "./api/types/ServiceLimitsReport";
import type { ResourceLimits } from "./api/types/ResourceLimits";
import type { FrontEndSwitch } from "./api/types/FrontEndSwitch";
import type { ServiceIdleSet } from "./api/types/ServiceIdleSet";
import type { ServiceCreate } from "./api/types/ServiceCreate";
import type { ServiceCreation } from "./api/types/ServiceCreation";
import type { ServiceDelete } from "./api/types/ServiceDelete";
import type { ServiceRemoval } from "./api/types/ServiceRemoval";
import type { DatabaseCreate } from "./api/types/DatabaseCreate";
import type { DatabaseAccount } from "./api/types/DatabaseAccount";
import type { DatabaseClientReport } from "./api/types/DatabaseClientReport";
import type { DomainStatusReport } from "./api/types/DomainStatusReport";
import type { CaStatus } from "./api/types/CaStatus";
import type { CertIssueReport } from "./api/types/CertIssueReport";
import type { BlueprintList } from "./api/types/BlueprintList";
import type { BlueprintSummary } from "./api/types/BlueprintSummary";
import type { BlueprintCapture } from "./api/types/BlueprintCapture";
import type { BlueprintImport } from "./api/types/BlueprintImport";
import type { BlueprintApply } from "./api/types/BlueprintApply";
import type { BlueprintApplyResponse } from "./api/types/BlueprintApplyResponse";
import type { InstalledExtensions } from "./api/types/InstalledExtensions";
import type { ExtensionCatalogue } from "./api/types/ExtensionCatalogue";
import type { ExtensionPlanRequest } from "./api/types/ExtensionPlanRequest";
import type { ExtensionPlan } from "./api/types/ExtensionPlan";
import type { ExtensionInstall } from "./api/types/ExtensionInstall";
import type { ExtensionUninstall } from "./api/types/ExtensionUninstall";
import type { ExtensionRemoval } from "./api/types/ExtensionRemoval";
import type { AutostartReport } from "./api/types/AutostartReport";
import type { UpdateStatus } from "./api/types/UpdateStatus";
import type { UpdateCheck } from "./api/types/UpdateCheck";
import type { UpdateDecide } from "./api/types/UpdateDecide";
import type { UpdateApply } from "./api/types/UpdateApply";
import type { UpdateApplied } from "./api/types/UpdateApplied";
import type { DoctorReport } from "./api/types/DoctorReport";
import type { DoctorRepair } from "./api/types/DoctorRepair";
import type { RepairReport } from "./api/types/RepairReport";
import type { UninstallQuery } from "./api/types/UninstallQuery";
import type { UninstallReport } from "./api/types/UninstallReport";
import type { BundleReport } from "./api/types/BundleReport";

/**
 * Chỗ duy nhất module này gọi `invoke()`.
 *
 * Frontend không chạm mạng và không chạm đĩa: nó gọi qua đây và vẽ thứ quay về. Kiểu của những
 * thứ quay về là hợp đồng của MixEngine, vendor nguyên xi ở `api/types/` — đừng viết lại chúng ở
 * đây, đó là `npm run bindings`.
 */

/** Daemon đang ở trạng thái nào, nhìn từ máy này. */
export type Presence = "running" | "notAnswering" | "notRunning" | "notInstalled";

export function presence(): Promise<Presence> {
  return invoke<Presence>("mixengine_presence");
}

/** Khởi động daemon; trả về endpoint nó in ra khi đã sẵn sàng. */
export function startDaemon(): Promise<string> {
  return invoke<string>("mixengine_start");
}

export function status(): Promise<DaemonStatus> {
  return invoke<DaemonStatus>("mixengine_status");
}

/** `service.list` trả `{ services: [...] }`, không phải một mảng trần — đo được trên daemon thật,
 *  và `ServiceList` trong hợp đồng nói đúng như vậy. */
export function services(): Promise<ServiceList> {
  return invoke<ServiceList>("mixengine_services");
}

export type ServiceAction = "start" | "stop" | "restart";

export function serviceAction(id: string, action: ServiceAction): Promise<unknown> {
  return invoke("mixengine_service_action", { id, action });
}

/**
 * Mở stream sự kiện.
 *
 * Mỗi message là JSON **thô**: người gọi tự parse, vì một `type` chưa biết phải bỏ qua được chứ
 * không phải làm vỡ gì. Sự kiện của MixEngine internally tagged, và một biến thể sinh ra ở phiên
 * bản sau phải tới được một MixDB cũ như một object nó nhận ra và lờ đi.
 */
export function watch(onMessage: (raw: string) => void): Promise<void> {
  const channel = new Channel<string>();
  channel.onmessage = onMessage;
  return invoke("mixengine_watch", { onEvent: channel });
}

export function unwatch(): Promise<void> {
  return invoke("mixengine_unwatch");
}

/**
 * Mọi thao tác đang chờ quyền quản trị, kèm câu daemon tự viết cho từng cái.
 *
 * `daemon.status` chỉ mang một con số. Một tab mở ra khi đã có sẵn thao tác chờ không nhận
 * `elevation_required` nào — sự kiện đó chỉ bắn lúc hàng đợi đổi — nên đây là đường duy nhất thấy
 * chúng.
 */
export function elevationStatus(): Promise<ElevationStatus> {
  return invoke<ElevationStatus>("mixengine_elevation_status");
}

/** Cho phép cả lô thao tác đang chờ — đúng một prompt của hệ điều hành.
 *
 *  **Trả về một job, không phải kết quả.** Daemon tạo hàng job rồi trả lời ngay; prompt bật lên
 *  *sau đó*, bên trong job. Ai gọi phải theo dõi qua `jobStatus` tới khi job xong — `result` của
 *  job là một `GrantOutcome` (`completed`/`declined`/`unavailable`). */
export function elevationGrant(): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_elevation_grant");
}

/** Bỏ cả lô đi. Từ chối là một kết cục bình thường, không phải một lỗi. */
export function elevationDrop(): Promise<unknown> {
  return invoke("mixengine_elevation_drop");
}

/** `project` lọc theo tên; bỏ trống thấy mọi site trong home. */
export function sites(project?: string): Promise<SiteList> {
  return invoke<SiteList>("mixengine_sites", { project });
}

/** Mọi thứ chỉ một lookup mới trả lời được: `doc_root_full`, `pool`, `services`. */
export function site(domain: string): Promise<SiteDetail> {
  return invoke<SiteDetail>("mixengine_site", { domain });
}

export function siteCreate(input: SiteCreate): Promise<SiteCreation> {
  return invoke<SiteCreation>("mixengine_site_create", { params: input });
}

/** `domains`/`services` thay thế toàn bộ danh sách site đang có, không merge. */
export function siteUpdate(input: SiteUpdate): Promise<{ site: SiteDetail }> {
  return invoke("mixengine_site_update", { params: input });
}

export function siteShare(input: SiteShare): Promise<SiteSharing> {
  return invoke<SiteSharing>("mixengine_site_share", { params: input });
}

export function siteUnshare(domain: string): Promise<unknown> {
  return invoke("mixengine_site_unshare", { domain });
}

export function projects(): Promise<ProjectList> {
  return invoke<ProjectList>("mixengine_projects");
}

/** Pin **hiệu lực** (file thắng row) kèm project — dùng cho cả trang chi tiết và form sửa. */
export function projectShow(name: string): Promise<ProjectDetail> {
  return invoke<ProjectDetail>("mixengine_project_show", { name });
}

/** `project.create` trả cả pin hiệu lực, đúng hình `ProjectDetail` — không phải `ProjectSummary`
 *  trần. Gọi `.project` để lấy hàng vừa tạo (xem `ProjectForm.tsx`, chỗ đã đọc nhầm tầng này). */
export function projectCreate(input: ProjectCreate): Promise<ProjectDetail> {
  return invoke<ProjectDetail>("mixengine_project_create", { params: input });
}

/** `pins` thay thế toàn bộ — gửi lại mọi pin hiện có cộng thay đổi. */
export function projectUpdate(input: ProjectUpdate): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("mixengine_project_update", { params: input });
}

/** Thư mục và `mixengine.toml` được giữ nguyên — chỉ gỡ đăng ký. */
export function projectDelete(name: string): Promise<ProjectRemoval> {
  return invoke<ProjectRemoval>("mixengine_project_delete", { name });
}

/** `domain.dns_status` là cả liệt kê lẫn chẩn đoán một tên — bỏ trống `domain` thấy mọi tên. */
export function domains(domain?: string): Promise<DomainStatusReport> {
  return invoke<DomainStatusReport>("mixengine_domains", { domain });
}

export function domainAdd(site: string, domain: string, acceptRiskyTld: boolean): Promise<unknown> {
  return invoke("mixengine_domain_add", {
    params: { site: { domain: site }, domain, accept_risky_tld: acceptRiskyTld },
  });
}

export function domainRemove(domain: string): Promise<unknown> {
  return invoke("mixengine_domain_remove", { domain });
}

/** Hai câu trả lời tin cậy, không phải một: `trust` là kho hệ thống, `browsers` là NSS database. */
export function caStatus(): Promise<CaStatus> {
  return invoke<CaStatus>("mixengine_ca_status");
}

/** Luồng hai lượt T64, giống `doctorRepair`: `grant: false` để enqueue, đọc `elevation.status`
 *  rồi mới `elevation.grant` sau khi người dùng đã xem hàng đợi — xem `CaBlock.tsx`. */
export function caRepair(input: DoctorRepair): Promise<unknown> {
  return invoke("mixengine_ca_repair", { params: input });
}

/** Bỏ trống `domain` để cấp cho mọi site có khai HTTPS — cùng một call vẽ bảng lẫn cấp lại. */
export function certs(domain?: string): Promise<CertIssueReport> {
  return invoke<CertIssueReport>("mixengine_certs", { domain });
}

export function runtimesInstalled(kind?: RuntimeKind): Promise<RuntimeList> {
  return invoke<RuntimeList>("mixengine_runtime_list_installed", { filter: { kind } });
}

export function runtimesAvailable(kind?: RuntimeKind): Promise<RuntimeCatalogue> {
  return invoke<RuntimeCatalogue>("mixengine_runtime_list_available", { filter: { kind } });
}

export function runtimeInstall(target: RuntimeTarget): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_runtime_install", { target });
}

export function runtimeUninstall(params: RuntimeUninstall): Promise<RuntimeRemoval> {
  return invoke<RuntimeRemoval>("mixengine_runtime_uninstall", { params });
}

export function runtimeSetDefault(target: RuntimeTarget): Promise<RuntimeSummary> {
  return invoke<RuntimeSummary>("mixengine_runtime_set_default", { target });
}

/** `runtime.list_extensions` trả một mảng trần theo bindings — không bọc trong `{ extensions: [] }`
 *  như `service.list`/`runtime.list_installed` làm; xác nhận lại khi Task 8 chạy thật với daemon. */
export function runtimeExtensions(target: RuntimeTarget): Promise<RuntimeExtension[]> {
  return invoke<RuntimeExtension[]>("mixengine_runtime_list_extensions", { target });
}

export function runtimeSetExtension(choice: ExtensionChoice): Promise<ExtensionChange> {
  return invoke<ExtensionChange>("mixengine_runtime_set_extension", { choice });
}

export function packagesInstalled(name?: string): Promise<PackageList> {
  return invoke<PackageList>("mixengine_package_list", { filter: { package: name } });
}

export function packagesAvailable(name?: string): Promise<PackageCatalogue> {
  return invoke<PackageCatalogue>("mixengine_package_list_available", { filter: { package: name } });
}

export function packageInstall(target: PackageTarget): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_package_install", { target });
}

export function packageUninstall(target: PackageTarget): Promise<PackageRemoval> {
  return invoke<PackageRemoval>("mixengine_package_uninstall", { target });
}

export function serviceLimits(service: string): Promise<ServiceLimitsReport> {
  return invoke<ServiceLimitsReport>("mixengine_service_limits", { service });
}

/** `ServiceLimitsSet` gửi toàn bộ ba field — không có patch. */
export function serviceSetLimits(
  service: string,
  limits: ResourceLimits,
): Promise<ServiceLimitsReport> {
  return invoke<ServiceLimitsReport>("mixengine_service_set_limits", {
    params: { service, limits },
  });
}

/** Hình dạng câu trả lời chưa có type đã vendor — đọc như `unknown`, ép kiểu tại chỗ gọi sau khi
 *  xác nhận với daemon thật (spec, Kiểm thử). */
export function serviceIdle(service: string): Promise<unknown> {
  return invoke("mixengine_service_idle", { service });
}

export function serviceSetIdle(params: ServiceIdleSet): Promise<unknown> {
  return invoke("mixengine_service_set_idle", { params });
}

/** Đổi web server mặc định — một job (theo dõi qua `jobStatus`), kết quả là `FrontEndReport`.
 *  Server đang active không có method đọc riêng: đọc `ServiceSummary.role` từ `services()`. */
export function serviceSetFrontEnd(params: FrontEndSwitch): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_service_set_front_end", { params });
}

/** `version` là bắt buộc — không có `service.resolve` nào chọn hộ, xem doc của `ServiceCreate`. */
export function serviceCreate(params: ServiceCreate): Promise<ServiceCreation> {
  return invoke<ServiceCreation>("mixengine_service_create", { params });
}

export function serviceDelete(params: ServiceDelete): Promise<ServiceRemoval> {
  return invoke<ServiceRemoval>("mixengine_service_delete", { params });
}

export function databaseCreate(input: DatabaseCreate): Promise<DatabaseAccount> {
  return invoke<DatabaseAccount>("mixengine_database_create", { params: input });
}

export function databaseClient(service: string): Promise<DatabaseClientReport> {
  return invoke<DatabaseClientReport>("mixengine_database_client", { service });
}

/** Không trả gì — thành công nghĩa là một tab `db` mới đã được xếp hàng mở, xem
 *  `Handoff`/`crate::launch::request` phía Rust. */
export function databaseOpenInMixDB(service: string, database?: string): Promise<void> {
  return invoke("mixengine_database_open_in_mixdb", { service, database });
}

/** Mở stream log của một service. Cùng khuôn `watch`/`unwatch` — một `Channel` mới, người gọi tự
 *  parse JSON thô. */
export function logsWatch(
  service: string,
  tail: number,
  follow: boolean,
  onLine: (raw: string) => void,
): Promise<void> {
  const channel = new Channel<string>();
  channel.onmessage = onLine;
  return invoke("mixengine_logs_watch", { service, tail, follow, onLine: channel });
}

export function logsUnwatch(): Promise<void> {
  return invoke("mixengine_logs_unwatch");
}

export function blueprints(): Promise<BlueprintList> {
  return invoke<BlueprintList>("mixengine_blueprints");
}

export function blueprintCapture(input: BlueprintCapture): Promise<BlueprintSummary> {
  return invoke<BlueprintSummary>("mixengine_blueprint_capture", { params: input });
}

/** Không bao giờ trả lỗi vì chữ ký sai — đọc lại `trusted`/`signature` trên kết quả, không bắt lỗi
 *  riêng cho trường hợp đó. */
export function blueprintImport(input: BlueprintImport): Promise<BlueprintSummary> {
  return invoke<BlueprintSummary>("mixengine_blueprint_import", { params: input });
}

/** Một method, gọi hai lượt — `input.dry_run` quyết định lượt nào. */
export function blueprintApply(input: BlueprintApply): Promise<BlueprintApplyResponse> {
  return invoke<BlueprintApplyResponse>("mixengine_blueprint_apply", { params: input });
}

/** Đọc job đã kết thúc — `applyJob` đã xoá hàng của nó khỏi danh sách job đang chạy trên stream. */
export function jobStatus(job: number): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_job_status", { job });
}

/** Output thật của một job (vd. lệnh `[scaffold]` của một blueprint) — cùng khuôn `logsWatch`, khác
 *  route phía Rust (`GET /logs/job/{id}` thay vì `/logs/service/{id}`). */
export function jobLogsWatch(
  job: number,
  tail: number,
  follow: boolean,
  onLine: (raw: string) => void,
): Promise<void> {
  const channel = new Channel<string>();
  channel.onmessage = onLine;
  return invoke("mixengine_job_logs_watch", { job, tail, follow, onLine: channel });
}

/** Cùng state phía Rust với `logsUnwatch` — đóng bất cứ stream log nào đang mở, service hay job. */
export function jobLogsUnwatch(): Promise<void> {
  return invoke("mixengine_logs_unwatch");
}

export function extensionsInstalled(): Promise<InstalledExtensions> {
  return invoke<InstalledExtensions>("mixengine_extension_list_installed");
}

export function extensionsAvailable(): Promise<ExtensionCatalogue> {
  return invoke<ExtensionCatalogue>("mixengine_extension_list_available");
}

/** Bước duy nhất trước khi cài — không có `extensionInspect`, xem Quyết định D2 spec. */
export function extensionPlan(input: ExtensionPlanRequest): Promise<ExtensionPlan> {
  return invoke<ExtensionPlan>("mixengine_extension_plan", { params: input });
}

/** `input.consent` phải trích nguyên từ `ExtensionPlan` vừa nhận — xem Quyết định D3 spec. */
export function extensionInstall(input: ExtensionInstall): Promise<unknown> {
  return invoke("mixengine_extension_install", { params: input });
}

export function extensionUninstall(input: ExtensionUninstall): Promise<ExtensionRemoval> {
  return invoke<ExtensionRemoval>("mixengine_extension_uninstall", { params: input });
}

/** Gọi `extension.*`, không phải `service.*` — xem Global Constraints. */
export function extensionStart(id: string): Promise<unknown> {
  return invoke("mixengine_extension_start", { id });
}

export function extensionStop(id: string): Promise<unknown> {
  return invoke("mixengine_extension_stop", { id });
}

/** Mở `GET /metrics`. Cùng khuôn `logsWatch` — một `Channel` mới, người gọi tự parse JSON thô.
 *  **Mở kết nối này chính là subscribe**: gọi đúng lúc màn hình cần số "bây giờ", đóng lại bằng
 *  `metricsUnwatch()` ngay khi không còn cần — không mở suốt đời app như `watch()`/`/events`. */
export function metricsWatch(onFrame: (raw: string) => void): Promise<void> {
  const channel = new Channel<string>();
  channel.onmessage = onFrame;
  return invoke("mixengine_metrics_watch", { onFrame: channel });
}

export function metricsUnwatch(): Promise<void> {
  return invoke("mixengine_metrics_unwatch");
}

export function diskUsage(refresh: boolean): Promise<DiskUsage> {
  return invoke<DiskUsage>("mixengine_disk_usage", { refresh });
}

export function cleanup(query: CleanupQuery): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_cleanup", { params: query });
}

export function metricsHistory(query: MetricsHistoryQuery): Promise<MetricsHistory> {
  return invoke<MetricsHistory>("mixengine_metrics_history", { params: query });
}

export function autostartStatus(): Promise<AutostartReport> {
  return invoke<AutostartReport>("mixengine_autostart_status");
}

export function autostartEnable(): Promise<AutostartReport> {
  return invoke<AutostartReport>("mixengine_autostart_enable");
}

export function autostartDisable(): Promise<AutostartReport> {
  return invoke<AutostartReport>("mixengine_autostart_disable");
}

export function updateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("mixengine_update_status");
}

export function updateCheck(input: UpdateCheck): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("mixengine_update_check", { params: input });
}

export function updateDecide(input: UpdateDecide): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("mixengine_update_decide", { params: input });
}

/** Daemon tự thoát ngay sau khi trả lời — kết nối đóng theo sau là thành công, không phải lỗi. */
export function updateApply(input: UpdateApply): Promise<UpdateApplied> {
  return invoke<UpdateApplied>("mixengine_update_apply", { params: input });
}

export function doctor(): Promise<DoctorReport> {
  return invoke<DoctorReport>("mixengine_doctor");
}

/** `grant: false` (đường thường) enqueue vào đúng hàng đợi `elevation.status` chung — đọc lại đó để
 *  biết có cần mở `ElevationDialog` không, không tự trả một dialog riêng. */
export function doctorRepair(input: DoctorRepair): Promise<RepairReport> {
  return invoke<RepairReport>("mixengine_doctor_repair", { params: input });
}

export function uninstallPlan(input: UninstallQuery): Promise<UninstallReport> {
  return invoke<UninstallReport>("mixengine_uninstall_plan", { params: input });
}

/** Trả một `JobSummary` — theo dõi qua `jobStatus`, không phải `UninstallReport` trực tiếp. */
export function uninstall(input: UninstallQuery): Promise<JobSummary> {
  return invoke<JobSummary>("mixengine_uninstall", { params: input });
}

export function bundle(): Promise<BundleReport> {
  return invoke<BundleReport>("mixengine_bundle");
}

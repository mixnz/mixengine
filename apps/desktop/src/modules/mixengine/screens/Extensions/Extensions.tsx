import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ExtensionOffer } from "../../api/types/ExtensionOffer";
import type { ExtensionOrigin } from "../../api/types/ExtensionOrigin";
import type { ExtensionSummary } from "../../api/types/ExtensionSummary";
import StaleBadge from "../../components/StaleBadge";
import { serviceStateKey } from "../../serviceStateLabel";
import PlanDialog from "./PlanDialog";
import styles from "./Extensions.module.css";

/**
 * Registry chào chính app này như một extension, và một trong các hàng đó **là** app đang chạy.
 *
 * Khớp theo `id`, không theo `kind`: `desktop-app` là một loại, không phải một danh tính, và một
 * desktop app khác xuất hiện trong registry sau này thì không phải cái đang mở màn hình này.
 */
const SELF = "mixdb";

/**
 * Registry, đã cài, cài (registry hoặc thư mục cục bộ), gỡ, bật/tắt một extension `kind: "service"`.
 *
 * Không có màn hình "cấu hình" — `extension.configure` không tồn tại (Quyết định D1, spec).
 */
export default function Extensions({ active }: { active: boolean }) {
  const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
  const [available, setAvailable] = useState<ExtensionOffer[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [stale, setStale] = useState(false);
  const [serviceState, setServiceState] = useState<Record<string, string | null | undefined>>({});
  const [error, setError] = useState("");
  const [installingSource, setInstallingSource] = useState<ExtensionOrigin | null>(null);
  const [uninstalling, setUninstalling] = useState<ExtensionSummary | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  /* Phiên bản app đang chạy, cho hàng `mixdb`. Registry nói phiên bản nó *xuất bản*, và với một
     hàng là chính app này thì con số đó trả lời sai câu hỏi người đọc đang hỏi. `""` là chưa hỏi
     xong — vài mili giây, và trong lúc đó hàng đó dùng con số của registry chứ không để trống. */
  const [appVersion, setAppVersion] = useState("");
  const { t } = useTranslation();

  useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [inst, avail, services] = await Promise.all([
        api.extensionsInstalled(),
        api.extensionsAvailable(),
        api.services(),
      ]);
      setInstalled(inst.extensions);
      setAvailable(avail.extensions);
      setUnreadable(avail.unreadable);
      setStale(avail.stale);
      const states: Record<string, string | null | undefined> = {};
      for (const svc of services.services) states[svc.id] = svc.state;
      setServiceState(states);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — cùng lý do `Dashboard.tsx`.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  async function browseInstallFromPath() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setInstallingSource({ type: "path", path: picked });
  }

  /** `extension.*`, không phải `service.*` — xem Global Constraints của plan này. */
  async function toggle(row: ExtensionSummary, action: "start" | "stop") {
    setError("");
    try {
      if (action === "start") await api.extensionStart(row.id);
      else await api.extensionStop(row.id);
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  async function confirmUninstall() {
    if (!uninstalling) return;
    setError("");
    try {
      await api.extensionUninstall({ id: uninstalling.id, delete_data: deleteData });
      setUninstalling(null);
      setDeleteData(false);
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }


  /** Trạng thái đã dịch; trạng thái lạ hiện nguyên văn daemon viết. Xem `serviceStateLabel.ts`. */
  function stateLabel(state: string | null | undefined): string {
    const key = serviceStateKey(state);
    return key === null ? (state ?? "—") : t(key);
  }

  /* MixDB nằm ở "đã cài" **không phải vì API nói vậy** — daemon báo nó chưa cài, và câu đó đúng
     theo nghĩa của daemon: nó chưa từng cài app này vào home nào cả. Nhưng người đang đọc màn hình
     này đang chạy nó. Nên hàng đó dựng từ chính app: tên và loại lấy từ registry nếu registry có
     nói, còn không thì lấy hằng số dưới đây; phiên bản luôn là phiên bản đang chạy.

     Và nó **chỉ xuất hiện một lần**: lọc khỏi cả hai danh sách trước, rồi thêm lại đúng một chỗ. */
  const selfOffer = available.find((offer) => offer.id === SELF);
  const selfInstalled = installed.find((row) => row.id === SELF);
  const otherInstalled = installed.filter((row) => row.id !== SELF);
  const otherAvailable = available.filter((offer) => offer.id !== SELF);
  const selfName = selfInstalled?.name ?? selfOffer?.name ?? "MixDB";
  const selfKind = selfInstalled?.kind ?? selfOffer?.kind ?? "desktop-app";

  return (
    <div className={styles.extensions}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className={styles.toolbar}>
        <Button onClick={() => void browseInstallFromPath()}>
          {t("mixengine.extensions.installFromPath")}
        </Button>
      </div>

      <h4>{t("mixengine.extensions.installedTitle")}</h4>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("mixengine.extensions.columnName")}</th>
            <th>{t("mixengine.extensions.columnVersion")}</th>
            <th>{t("mixengine.extensions.columnKind")}</th>
            <th>{t("mixengine.extensions.columnState")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr key={SELF}>
            <td>{selfName}</td>
            {/* Phiên bản đang chạy, không phải phiên bản registry xuất bản — hai số lệch nhau ngay
                khi app tự cập nhật. Registry đứng chờ trong lúc `getVersion()` chưa trả lời. */}
            <td>{appVersion || selfOffer?.version || "—"}</td>
            <td>{selfKind}</td>
            <td>—</td>
            <td className={styles.rowActions}>
              {/* Không có nút Gỡ: một app không tự gỡ chính nó từ bên trong nó được, và cập nhật
                  đã có đường riêng ở Settings. */}
              <span className={styles.installedBadge}>{t("mixengine.extensions.thisApp")}</span>
            </td>
          </tr>
          {otherInstalled.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.version}</td>
              <td>{row.kind}</td>
              <td>{row.kind === "service" ? stateLabel(serviceState[row.id]) : "—"}</td>
              <td className={styles.rowActions}>
                {row.kind === "service" && (
                  <>
                    <Button onClick={() => void toggle(row, "start")}>
                      {t("mixengine.extensions.start")}
                    </Button>
                    <Button onClick={() => void toggle(row, "stop")}>
                      {t("mixengine.extensions.stop")}
                    </Button>
                  </>
                )}
                <Button onClick={() => setUninstalling(row)}>
                  {t("mixengine.extensions.uninstall")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>
        {t("mixengine.extensions.registryTitle")} <StaleBadge stale={stale} />
      </h4>
      {unreadable > 0 && (
        <p className={styles.hint}>{t("mixengine.extensions.unreadable", { count: unreadable })}</p>
      )}
      <table className={styles.table}>
        <tbody>
          {otherAvailable.map((offer) => (
            <tr key={offer.id}>
              <td>{offer.name}</td>
              <td>{offer.version}</td>
              <td>{offer.kind}</td>
              <td className={styles.rowActions}>
                {offer.installed ? (
                  <span className={styles.installedBadge}>{t("mixengine.extensions.installed")}</span>
                ) : (
                  <Button onClick={() => setInstallingSource({ type: "registry", id: offer.id })}>
                    {t("mixengine.extensions.install")}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {installingSource && (
        <PlanDialog
          source={installingSource}
          onCancel={() => setInstallingSource(null)}
          onInstalled={() => {
            setInstallingSource(null);
            void reload();
          }}
        />
      )}

      {uninstalling && (
        <ConfirmDialog
          title={t("mixengine.extensions.uninstallTitle", { name: uninstalling.name })}
          message={t("mixengine.extensions.uninstallMessage")}
          danger
          onCancel={() => {
            setUninstalling(null);
            setDeleteData(false);
          }}
          onConfirm={() => void confirmUninstall()}
        >
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => setDeleteData(e.target.checked)}
            />
            {t("mixengine.extensions.deleteData")}
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

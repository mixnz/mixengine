import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { RuntimeRelease } from "../../api/types/RuntimeRelease";
import type { RuntimeSummary } from "../../api/types/RuntimeSummary";
import { applyJob, type JobRow } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import { formatInstalledAt, jobFinished, jobFor, versionKey } from "../../runtimeState";
import StaleBadge from "../../components/StaleBadge";
import ExtensionsPanel from "./ExtensionsPanel";
import styles from "./Languages.module.css";

export default function Languages({ active }: { active: boolean }) {
  const [installed, setInstalled] = useState<RuntimeSummary[]>([]);
  const [available, setAvailable] = useState<RuntimeRelease[]>([]);
  const [stale, setStale] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [installingJob, setInstallingJob] = useState<Record<string, number>>({});
  const [uninstallTarget, setUninstallTarget] = useState<RuntimeSummary | null>(null);
  const [forceHint, setForceHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  // Đọc được giá trị `installingJob` mới nhất từ trong callback `watch` đăng ký một lần — effect
  // dưới không có `installingJob` trong deps (đăng ký lại watch mỗi lần map đó đổi là vô nghĩa).
  const installingJobRef = useRef(installingJob);
  useEffect(() => {
    installingJobRef.current = installingJob;
  }, [installingJob]);

  // `stillShow` là câu lỗi phải sống sót qua lần đọc lại này. Một job cài hỏng vẫn phải được kể
  // lại dù lần đọc ngay sau đó trả lời bình thường: đọc lại được không có nghĩa là việc cài đã
  // xong. Rỗng — mặc định — là "đọc xong thì màn hình sạch", đúng như trước.
  const reload = useCallback(
    async (stillShow = "") => {
      try {
        const [inst, avail] = await Promise.all([api.runtimesInstalled(), api.runtimesAvailable()]);
        setInstalled(inst.runtimes);
        setAvailable(avail.runtimes);
        setStale(avail.stale);
        setError(stillShow);
      } catch (e) {
        setError(errorMessage(t, e));
      }
    },
    [t],
  );

  // Đọc lại lúc mount và mỗi lần vừa quay lại tab này — cùng lý do `Dashboard.tsx`. Tách khỏi
  // effect watch bên dưới: watch phải sống suốt vòng đời component (job đang cài vẫn phải được
  // theo dõi khi người dùng ghé qua Gói hay màn khác), còn reload chỉ cần chạy khi *đang nhìn*.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      setJobs((current) => applyJob(current, raw));
      // Job đang theo dõi vừa xong: bảng "đã cài" không tự biết bản mới trừ khi đọc lại — không
      // có API nào khác báo tin này (T3, `daemonState.ts`: sự kiện không bao giờ là đường duy
      // nhất, nhưng ở đây nó là đường *đầu tiên*, còn mở lại tab vẫn là đường dự phòng).
      const finished = jobFinished(raw);
      if (finished !== null && Object.values(installingJobRef.current).includes(finished.id)) {
        // Job hỏng thì `job_finished` là chỗ duy nhất nói ra vì sao — xem `jobFinished`. Đọc lại
        // vẫn phải chạy (một job hỏng nửa chừng vẫn có thể đã đổi thứ gì đó), nhưng nó không được
        // xoá mất câu lỗi vừa tới.
        void reload(finished.error === null ? "" : errorMessage(t, finished.error));
        setInstallingJob((current) => {
          const next = { ...current };
          for (const key of Object.keys(next)) {
            if (next[key] === finished.id) delete next[key];
          }
          return next;
        });
      }
    });
  }, [reload, t]);

  async function install(release: RuntimeRelease) {
    setError("");
    try {
      const job = await api.runtimeInstall({ kind: release.kind, version: release.version });
      setInstallingJob((current) => ({
        ...current,
        [versionKey(release.kind, release.version)]: job.id,
      }));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  async function uninstall(target: RuntimeSummary, force: boolean) {
    setError("");
    try {
      await api.runtimeUninstall({ kind: target.kind, version: target.version, force });
      setUninstallTarget(null);
      setForceHint(null);
      void reload();
    } catch (e) {
      // `force` chưa gửi và refuse là vì project pin: hỏi lại có `force` không, hiện đúng message
      // daemon đã viết (nó nêu tên project) thay vì một câu tự bịa.
      if (!force) {
        setForceHint(errorMessage(t, e));
      } else {
        setError(errorMessage(t, e));
      }
    }
  }

  async function setDefault(target: RuntimeSummary) {
    setError("");
    try {
      await api.runtimeSetDefault({ kind: target.kind, version: target.version });
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  return (
    <div className={styles.languages}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("mixengine.runtimes.columnVersion")}</th>
            <th>{t("mixengine.runtimes.columnChannel")}</th>
            <th>{t("mixengine.runtimes.columnInstalledAt")}</th>
            <th>{t("mixengine.runtimes.columnDefault")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {installed.map((row) => {
            const key = versionKey(row.kind, row.version);
            return (
              <Fragment key={key}>
                <tr>
                  <td>
                    <button
                      className={styles.versionButton}
                      onClick={() => setExpanded(expanded === key ? null : key)}
                    >
                      {row.kind} {row.version}
                    </button>
                  </td>
                  <td>{row.channel}</td>
                  <td>{formatInstalledAt(row.installed_at)}</td>
                  <td>{row.default ? "✓" : "—"}</td>
                  <td className={styles.actions}>
                    {!row.default && (
                      <Button onClick={() => void setDefault(row)}>
                        {t("mixengine.runtimes.setDefault")}
                      </Button>
                    )}
                    <Button onClick={() => setUninstallTarget(row)}>
                      {t("mixengine.runtimes.uninstall")}
                    </Button>
                  </td>
                </tr>
                {expanded === key && row.kind === "php" && (
                  <tr>
                    <td colSpan={5}>
                      <ExtensionsPanel target={{ kind: row.kind, version: row.version }} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <h4>
        {t("mixengine.runtimes.columnVersion")} <StaleBadge stale={stale} />
      </h4>
      <table className={styles.table}>
        <tbody>
          {available
            .filter((release) => !release.installed)
            .map((release) => {
              const key = versionKey(release.kind, release.version);
              const job = jobFor(jobs, installingJob[key]);
              return (
                <tr key={key}>
                  <td>
                    {release.kind} {release.version}
                  </td>
                  <td>{release.channel}</td>
                  <td className={styles.actions}>
                    {job ? (
                      <span className={styles.progress}>
                        <progress value={job.percent} max={100} />
                        {job.message}
                      </span>
                    ) : (
                      <Button onClick={() => void install(release)}>
                        {t("mixengine.runtimes.install")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {uninstallTarget && (
        <ConfirmDialog
          title={t("mixengine.runtimes.uninstallConfirmTitle", { version: uninstallTarget.version })}
          message={forceHint ?? uninstallTarget.version}
          confirmLabel={
            forceHint !== null ? t("mixengine.runtimes.uninstallForceConfirm") : undefined
          }
          danger
          onCancel={() => {
            setUninstallTarget(null);
            setForceHint(null);
          }}
          onConfirm={() => void uninstall(uninstallTarget, forceHint !== null)}
        />
      )}
    </div>
  );
}

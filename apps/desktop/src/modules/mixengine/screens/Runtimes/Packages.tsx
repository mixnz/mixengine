import { useCallback, useEffect, useRef, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import { Tab, TabStrip, tabKeyDown } from "../../../../components/TabStrip";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { PackageRelease } from "../../api/types/PackageRelease";
import type { PackageSummary } from "../../api/types/PackageSummary";
import { applyJob, type JobRow } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import { formatInstalledAt, jobFinished, jobFor, versionKey } from "../../runtimeState";
import StaleBadge from "../../components/StaleBadge";
import { PACKAGE_CATEGORY_ORDER, packageCategory, type PackageCategory } from "./packageCategories";
import styles from "./Packages.module.css";

export default function Packages({ active }: { active: boolean }) {
  const [installed, setInstalled] = useState<PackageSummary[]>([]);
  const [available, setAvailable] = useState<PackageRelease[]>([]);
  const [stale, setStale] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [installingJob, setInstallingJob] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<PackageCategory>("web");
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const categoryLabel: Record<PackageCategory, string> = {
    web: t("mixengine.runtimes.categoryWeb"),
    database: t("mixengine.runtimes.categoryDatabase"),
    cache: t("mixengine.runtimes.categoryCache"),
    other: t("mixengine.runtimes.categoryOther"),
  };

  // Tab nào có mặt phụ thuộc dữ liệu (không vẽ một tab luôn rỗng), nhưng thứ tự thì cố định —
  // xem `PACKAGE_CATEGORY_ORDER`.
  const categoriesPresent = PACKAGE_CATEGORY_ORDER.filter(
    (cat) =>
      installed.some((row) => packageCategory(row.package) === cat) ||
      available.some((release) => packageCategory(release.package) === cat),
  );

  useEffect(() => {
    if (categoriesPresent.length > 0 && !categoriesPresent.includes(category)) {
      setCategory(categoriesPresent[0]);
    }
  }, [categoriesPresent, category]);

  const installedInCategory = installed.filter((row) => packageCategory(row.package) === category);
  const availableInCategory = available.filter(
    (release) => packageCategory(release.package) === category,
  );

  // Cùng lý do `Languages.tsx` đã theo: đọc `installingJob` mới nhất trong callback `watch` đăng
  // ký một lần, không đăng ký lại watch mỗi lần map đó đổi.
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
        const [inst, avail] = await Promise.all([api.packagesInstalled(), api.packagesAvailable()]);
        setInstalled(inst.packages);
        setAvailable(avail.packages);
        setStale(avail.stale);
        setError(stillShow);
      } catch (e) {
        setError(errorMessage(t, e));
      }
    },
    [t],
  );

  // Đọc lại lúc mount và mỗi lần vừa quay lại tab này — cùng lý do `Languages.tsx`/`Dashboard.tsx`.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      setJobs((current) => applyJob(current, raw));
      // Job đang theo dõi vừa xong: đọc lại "đã cài"/"có thể cài" — không có tin nào khác báo
      // chuyện này, xem `Languages.tsx`.
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

  async function install(release: PackageRelease) {
    setError("");
    try {
      const job = await api.packageInstall({ package: release.package, version: release.version });
      setInstallingJob((current) => ({
        ...current,
        [versionKey(release.package, release.version)]: job.id,
      }));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  /** Không có `force` — refuse vì `services` không rỗng là chốt (D6). Vẽ danh sách, dừng ở đó. */
  async function uninstall(target: PackageSummary) {
    setError("");
    try {
      await api.packageUninstall({ package: target.package, version: target.version });
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  return (
    <div className={styles.packages}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {categoriesPresent.length > 1 && (
        <TabStrip size="small" role="tablist" className={styles.categoryTabStrip}>
          {categoriesPresent.map((cat) => {
            const active = cat === category;
            const pick = () => setCategory(cat);
            return (
              <Tab
                key={cat}
                active={active}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={pick}
                onKeyDown={tabKeyDown(pick)}
              >
                {categoryLabel[cat]}
              </Tab>
            );
          })}
        </TabStrip>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("mixengine.runtimes.columnVersion")}</th>
            <th>{t("mixengine.runtimes.columnInstalledAt")}</th>
            <th>{t("mixengine.runtimes.columnServices")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {installedInCategory.map((row) => {
            const key = versionKey(row.package, row.version);
            return (
              <tr key={key}>
                <td>
                  {row.package} {row.version}
                </td>
                <td>{formatInstalledAt(row.installed_at)}</td>
                <td>{row.services.length > 0 ? row.services.join(", ") : "—"}</td>
                <td className={styles.actions}>
                  <Button onClick={() => void uninstall(row)} disabled={row.services.length > 0}>
                    {t("mixengine.runtimes.uninstall")}
                  </Button>
                  {row.services.length > 0 && (
                    <p className={styles.blockedHint}>
                      {t("mixengine.runtimes.uninstallBlockedMessage", {
                        services: row.services.join(", "),
                      })}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>
        {t("mixengine.runtimes.columnVersion")} <StaleBadge stale={stale} />
      </h4>
      <table className={styles.table}>
        <tbody>
          {availableInCategory
            .filter((release) => !release.installed)
            .map((release) => {
              const key = versionKey(release.package, release.version);
              const job = jobFor(jobs, installingJob[key]);
              return (
                <tr key={key}>
                  <td>
                    {release.package} {release.version}
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
    </div>
  );
}

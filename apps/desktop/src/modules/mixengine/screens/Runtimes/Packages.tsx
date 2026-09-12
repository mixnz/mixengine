import { useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import { useTranslation } from "../../../../i18n";
import { formatInstalledAt, jobFor, versionKey } from "../../runtimeState";
import StaleBadge from "../../components/StaleBadge";
import { matchesAvailable } from "./availableFilter";
import { packageCategory, type PackageCategory } from "./packageCategories";
import type { PackagesState } from "./usePackages";
import styles from "./Packages.module.css";

/**
 * Một nhóm package — nhóm nào là do dải tab của `Runtimes.tsx` quyết định, không phải một tab con
 * ở đây: bốn nhóm đứng ngang hàng với Ngôn ngữ trên đúng một dải tab, không lồng hai tầng.
 * State thì ở `usePackages`, cao hơn mọi tab, nên đổi nhóm không làm mất dấu một job đang cài.
 */
export default function Packages({
  category,
  state,
}: {
  category: PackageCategory;
  state: PackagesState;
}) {
  const { t } = useTranslation();
  const { installed, available, stale, jobs, installingJob, error, clearError } = state;

  // Chỉ lọc bảng "chưa cài": bảng trên là những bản máy này đang giữ, thường vài hàng, và giấu bớt
  // chúng sau một câu tìm kiếm là giấu đúng thứ người dùng cần thấy đủ trước khi gỡ.
  const [filter, setFilter] = useState("");

  const installedInCategory = installed.filter((row) => packageCategory(row.package) === category);
  const availableInCategory = available.filter(
    (release) =>
      packageCategory(release.package) === category &&
      !release.installed &&
      matchesAvailable([release.package, release.version, release.channel], filter),
  );

  return (
    <div className={styles.packages}>
      {error !== "" && <ErrorBanner message={error} onDismiss={clearError} />}

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
                  <Button
                    onClick={() => void state.uninstall(row)}
                    disabled={row.services.length > 0}
                  >
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

      <div className={styles.availableHeader}>
        <h4 className={styles.availableTitle}>
          {t("mixengine.runtimes.columnVersion")} <StaleBadge stale={stale} />
        </h4>
        <Input
          size="small"
          allowClear
          className={styles.filter}
          placeholder={t("mixengine.runtimes.searchAvailable")}
          aria-label={t("mixengine.runtimes.searchAvailable")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            // Escape xoá câu tìm, và dừng ở đây — không để nó nổi lên đóng cả tab đang mở.
            if (e.key !== "Escape" || filter === "") return;
            e.preventDefault();
            e.stopPropagation();
            setFilter("");
          }}
        />
      </div>
      <table className={styles.table}>
        <tbody>
          {availableInCategory.map((release) => {
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
                    <Button onClick={() => void state.install(release)}>
                      {t("mixengine.runtimes.install")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {availableInCategory.length === 0 && filter.trim() !== "" && (
        <p className={styles.noMatches}>{t("mixengine.runtimes.noMatches")}</p>
      )}
    </div>
  );
}

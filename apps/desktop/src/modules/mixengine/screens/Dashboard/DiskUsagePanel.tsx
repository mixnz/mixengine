import { useTranslation } from "../../../../i18n";
import type { CategoryUsage } from "../../api/types/CategoryUsage";
import type { DiskUsage } from "../../api/types/DiskUsage";
import { isCleanupReclaimable } from "../../diskUsageState";
import { formatBytes } from "../../metricsState";
import styles from "./DiskUsagePanel.module.css";

interface Props {
  disk: DiskUsage | null;
  refreshing: boolean;
  onRefresh: () => void;
  onCleanup: () => void;
}

/** Vì sao một hạng mục dọn được hay không — bốn biến thể `Reclaim`, một câu mỗi cái, daemon nói chứ
 *  không phải MixDB suy ra từ tên hạng mục (đúng luật `Reclaim` doc-comment đã nêu). */
function reclaimNote(category: CategoryUsage, t: ReturnType<typeof useTranslation>["t"]): string {
  const { reclaim } = category;
  switch (reclaim.reclaim) {
    case "by_cleanup":
      return t("mixengine.dashboard.diskUsage.reclaimByCleanup", {
        size: formatBytes(reclaim.bytes),
      });
    case "by_method":
      return reclaim.because;
    case "at_a_cost":
      return reclaim.because;
    case "never":
      return reclaim.because;
  }
}

/**
 * Bảng disk usage 5 hạng mục cố định (T96), mỗi hạng mục vẽ khác nhau theo `Reclaim` daemon trả về.
 *
 * **Chỉ hai hạng mục (`logs`, `cache`) có nút dọn** — ba cái còn lại (`runtimes`, `data`, `certs`)
 * chỉ đọc, trỏ người dùng sang đúng chỗ dọn được (màn Runtimes, hoặc tự tay). Nút "Dọn dẹp" luôn
 * hiện — dialog tự lọc đúng hai hàng dọn được, không có gì để bấm nếu daemon nói không hạng mục nào
 * dọn được lúc đó.
 */
export default function DiskUsagePanel({ disk, refreshing, onRefresh, onCleanup }: Props) {
  const { t } = useTranslation();

  if (disk === null) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h3 className={styles.title}>{t("mixengine.dashboard.diskUsage.title")}</h3>
        <span className={styles.measuredAt}>
          {t("mixengine.dashboard.diskUsage.measuredAt", {
            time: new Date(disk.measured_at).toLocaleTimeString(),
          })}
        </span>
        <div className={styles.headerButtons}>
          <button onClick={onRefresh} disabled={refreshing}>
            {t("mixengine.dashboard.diskUsage.refresh")}
          </button>
          <button
            onClick={onCleanup}
            disabled={!disk.categories.some((category) => isCleanupReclaimable(category))}
          >
            {t("mixengine.dashboard.diskUsage.cleanup")}
          </button>
        </div>
      </header>

      <ul className={styles.categories}>
        {disk.categories.map((category) => (
          <li key={category.id} className={styles.category}>
            <span className={styles.name}>{t(`mixengine.dashboard.diskUsage.category.${category.id}`)}</span>
            <span className={styles.size} title={category.location}>
              {formatBytes(category.bytes)}
            </span>
            <span className={styles.note}>{reclaimNote(category, t)}</span>
            {category.unreadable != null && (
              <span className={styles.unreadable}>
                {t("mixengine.dashboard.diskUsage.unreadable", { reason: category.unreadable })}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className={styles.other}>
        {t("mixengine.dashboard.diskUsage.other", { size: formatBytes(disk.other_bytes) })}
      </p>
    </section>
  );
}

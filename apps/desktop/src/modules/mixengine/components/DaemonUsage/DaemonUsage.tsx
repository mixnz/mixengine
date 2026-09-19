import type { MetricsSample } from "@mixengine/api";

import { useTranslation } from "../../../../i18n";
import { formatBytes, formatPercent } from "../../metricsState";
import styles from "./DaemonUsage.module.css";

/**
 * The daemon's own CPU and memory — the Dashboard's header strip, and since T168 the tray panel's.
 *
 * Always drawn, before the first frame too: `null` shows "—" in a strip that is already the size
 * it will be, instead of one that appears later and pushes everything under it down.
 */
export default function DaemonUsage({
  reading,
  className,
}: {
  reading: MetricsSample | null;
  /** For a caller that lays the strip out differently — the tray stretches it across its card. */
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={className ? `${styles.usage} ${className}` : styles.usage} role="group" aria-label={t("mixengine.dashboard.daemon")}>
      <span className={styles.cell}>
        <span className={reading ? styles.liveDot : `${styles.liveDot} ${styles.liveDotIdle}`} aria-hidden="true" />
        <strong>{t("mixengine.dashboard.daemon")}</strong>
      </span>
      <span className={styles.cell}>
        <span className={styles.label}>{t("mixengine.dashboard.cpu")}</span>
        <span className={styles.value}>
          {reading === null || reading.cpu_percent === null ? "—" : formatPercent(reading.cpu_percent)}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <span
            style={{
              width: reading === null ? 0 : `${Math.min(100, Math.max(3, reading.cpu_percent ?? 0))}%`,
            }}
          />
        </span>
      </span>
      <span className={styles.cell}>
        <span className={styles.label}>{t("mixengine.dashboard.memory")}</span>
        <span className={styles.value}>{reading === null ? "—" : formatBytes(reading.rss_bytes)}</span>
      </span>
    </div>
  );
}

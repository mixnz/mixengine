import { useCallback, useEffect, useState } from "react";

import ErrorBanner from "../../../../components/ErrorBanner";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { MetricsHistory } from "../../api/types/MetricsHistory";
import { segmentsFor } from "../../metricsHistoryState";
import { DAEMON_SUBJECT, metricsSubjectFor } from "../../metricsState";
import Chart from "./Chart";
import styles from "./Metrics.module.css";

/**
 * Lịch sử 24 giờ theo subject — chỉ lịch sử, không lặp lại số "bây giờ" Dashboard đã vẽ (Quyết định
 * D1, spec Metrics/Settings). `metrics.history` là một RPC đọc thường, không cần giữ stream nào mở.
 */
export default function Metrics({ active }: { active: boolean }) {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState(DAEMON_SUBJECT);
  const [history, setHistory] = useState<MetricsHistory | null>(null);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  // Danh sách service chỉ để dựng bộ chọn — đọc một lần lúc màn hình được xem tới, không cần theo
  // dõi stream nào vì đây không phải bảng trạng thái sống như Dashboard.
  useEffect(() => {
    if (!active) return;
    void api
      .services()
      .then((list) => setSubjects(list.services.map((service) => metricsSubjectFor(service.id))))
      .catch((e) => setError(errorMessage(t, e)));
  }, [active, t]);

  const reload = useCallback(async () => {
    try {
      setHistory(await api.metricsHistory({ subject, since: null, until: null }));
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [subject, t]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  const minutes = history?.minutes ?? [];
  const segments = segmentsFor(minutes);

  return (
    <div className={styles.metrics}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <header className={styles.header}>
        <span>{t("mixengine.metrics.subject")}</span>
        <Select
          value={subject}
          onChange={setSubject}
          searchable
          options={[
            { value: DAEMON_SUBJECT, label: t("mixengine.metrics.daemon") },
            ...subjects.map((s) => ({ value: s, label: s.replace(/^service:/, "") })),
          ]}
        />
      </header>

      {minutes.length === 0 ? (
        <p className={styles.empty}>{t("mixengine.metrics.empty")}</p>
      ) : (
        <>
          <section>
            <h3 className={styles.title}>{t("mixengine.metrics.cpu")}</h3>
            <Chart segments={segments} avg={(m) => m.cpu_avg} peak={(m) => m.cpu_peak} />
          </section>
          <section>
            <h3 className={styles.title}>{t("mixengine.metrics.rss")}</h3>
            <Chart segments={segments} avg={(m) => m.rss_avg} peak={(m) => m.rss_peak} />
          </section>
        </>
      )}

      {history && (
        <p className={styles.retention}>
          {t("mixengine.metrics.retention", { hours: history.retention_hours })}
        </p>
      )}
    </div>
  );
}

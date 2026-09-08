import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";

import Button from "../../../../components/Button";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { BundleReport } from "../../api/types/BundleReport";
import { formatBytes } from "../../metricsState";
import styles from "./Settings.module.css";

/**
 * `daemon.bundle` — một archive, một đường dẫn. "Copy diagnostics" là một file để mở, không phải
 * năm chỗ để đọc (T4.8). `omitted` vẽ luôn, không trình bày archive như đã đầy đủ.
 */
export default function DiagnosticsSection({ onError }: { onError: (message: string) => void }) {
  const [report, setReport] = useState<BundleReport | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  async function collect() {
    setBusy(true);
    try {
      setReport(await api.bundle());
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.diagnostics.title")}</h3>

      <Button onClick={() => void collect()} disabled={busy}>
        {t("mixengine.settings.diagnostics.collect")}
      </Button>

      {report && (
        <>
          <div className={styles.row}>
            <span>{t("mixengine.settings.diagnostics.result", { size: formatBytes(report.bytes) })}</span>
            <Button onClick={() => void revealItemInDir(report.path)}>
              {t("mixengine.settings.diagnostics.reveal")}
            </Button>
          </div>
          {report.omitted.length > 0 && (
            <ul className={styles.list}>
              {report.omitted.map((item) => (
                <li key={item.name} className={styles.listItem}>
                  <span>{item.name}</span>
                  <span className={styles.muted}>{item.because}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

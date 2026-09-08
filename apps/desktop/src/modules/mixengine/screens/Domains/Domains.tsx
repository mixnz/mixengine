import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DomainStatus } from "../../api/types/DomainStatus";
import { isJobFinished, needsResync } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import AddDomainDialog from "./AddDomainDialog";
import CaBlock from "./CaBlock";
import CertTable from "./CertTable";
import styles from "./Domains.module.css";

/**
 * Bảng chẩn đoán domain — T2.5.
 *
 * **Bốn sự thật độc lập, không một verdict.** `hosts_entry`, `wildcard`, `server_answers`,
 * `resolves_to` mỗi cái trả lời một câu hỏi khác nhau; `because` là câu duy nhất nói cái gì sai,
 * vẽ nguyên văn — không dịch, vì đó là câu daemon tự viết.
 *
 * **Cả ba khối (CA, bảng domain, bảng chứng chỉ) đọc lại khi một job kết thúc**, không chỉ lúc
 * mount hay lúc quay lại màn. Một `elevation.grant` xong (từ "Fix browser trust" ngay đây, từ
 * Dashboard, hay từ CLI) đổi cả `because` của từng domain lẫn trạng thái CA, mà daemon không phát
 * sự kiện riêng nào cho chuyện đó — `job_finished` là tín hiệu (xem `isJobFinished`). `revision`
 * là cách màn này bảo hai khối con đọc lại mà không bắt mỗi khối tự subscribe kênh sự kiện.
 */
export default function Domains({ active }: { active: boolean }) {
  const [rows, setRows] = useState<DomainStatus[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  /** Tăng mỗi lần có lý do để mọi khối đọc lại — `CaBlock`/`CertTable` đọc lại khi nó đổi. */
  const [revision, setRevision] = useState(0);
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const report = await api.domains();
      setRows(report.domains);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — cùng lý do `Dashboard.tsx`.
  useEffect(() => {
    if (active) {
      void reload();
      setRevision((n) => n + 1);
    }
  }, [active, reload]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      if (isJobFinished(raw) || needsResync(raw)) {
        void reload();
        setRevision((n) => n + 1);
      }
    });
  }, [reload]);

  async function remove(domain: string) {
    try {
      await api.domainRemove(domain);
      await reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  return (
    <div className={styles.domains}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <CaBlock revision={revision} onError={setError} />

      <div className={styles.toolbar}>
        <Button variant="primary" onClick={() => setAdding(true)}>
          {t("mixengine.domains.addDomain")}
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("mixengine.domains.columnDomain")}</th>
              <th>{t("mixengine.domains.columnSite")}</th>
              <th>{t("mixengine.domains.columnHosts")}</th>
              <th>{t("mixengine.domains.columnWildcard")}</th>
              <th>{t("mixengine.domains.columnServer")}</th>
              <th>{t("mixengine.domains.columnResolves")}</th>
              <th className={styles.reason}>{t("mixengine.domains.columnReason")}</th>
              <th className={styles.actions}>{t("mixengine.domains.columnActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.domain}>
                <td>{row.domain}</td>
                <td>{row.site ?? "—"}</td>
                <td>{row.hosts_entry ? "✓" : "—"}</td>
                <td>{row.wildcard ? "✓" : "—"}</td>
                <td>{row.server_answers ?? "—"}</td>
                <td>{row.resolves_to.length > 0 ? row.resolves_to.join(", ") : "—"}</td>
                {/* `because` là "một câu nói cái gì sai, hoặc None khi không có gì sai" (doc-comment
                    `DomainStatus`) — có chữ là có lỗi, nên màu đỏ đọc được trước cả câu. */}
                <td className={`${styles.reason} ${styles.bad}`}>{row.because ?? ""}</td>
                <td className={styles.actions}>
                  <Button onClick={() => void remove(row.domain)}>
                    {t("mixengine.domains.remove")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className={styles.empty}>{t("mixengine.domains.empty")}</p>}

      <CertTable revision={revision} onError={setError} />

      {adding && (
        <AddDomainDialog
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

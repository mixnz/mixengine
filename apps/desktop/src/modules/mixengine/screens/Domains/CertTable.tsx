import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import { buildCertRows, type CertRow } from "../../certTable";
import styles from "./CertTable.module.css";

type Translate = ReturnType<typeof useTranslation>["t"];

function outcomeLabel(row: CertRow, t: Translate): string {
  switch (row.outcome.outcome) {
    case "issued":
      return t("mixengine.domains.certs.outcome.issued");
    case "reused":
      return t("mixengine.domains.certs.outcome.reused");
    case "not_wanted":
      return t("mixengine.domains.certs.outcome.notWanted", { reason: row.outcome.because });
    case "refused":
      return t("mixengine.domains.certs.outcome.refused", { reason: row.outcome.because });
  }
}

/**
 * Chứng chỉ từng site — T2.7.
 *
 * **Một call `cert.issue` không `site` vẽ cả bảng.** Cấp lại một hàng là gọi lại đúng method đó với
 * `{ site }` — idempotent, không bật prompt.
 */
export default function CertTable({
  revision,
  onError,
}: {
  /** Đổi là đọc lại — `Domains` tăng nó khi một job kết thúc hay khi màn được mở lại. */
  revision: number;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CertRow[]>([]);
  const [reissuing, setReissuing] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(buildCertRows(await api.certs()));
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [onError, t]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  async function reissue(domain: string) {
    setReissuing(domain);
    try {
      const [row] = buildCertRows(await api.certs(domain));
      if (row) setRows((current) => current.map((r) => (r.domain === domain ? row : r)));
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setReissuing(null);
    }
  }

  return (
    <section className={styles.block}>
      <h3 className={styles.title}>{t("mixengine.domains.certs.title")}</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("mixengine.domains.certs.columnDomain")}</th>
              <th>{t("mixengine.domains.certs.columnNames")}</th>
              <th>{t("mixengine.domains.certs.columnDaysLeft")}</th>
              <th>{t("mixengine.domains.certs.columnStatus")}</th>
              <th>{t("mixengine.domains.certs.columnActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.domain}>
                <td>{row.domain}</td>
                <td>{row.sans.length > 0 ? row.sans.join(", ") : "—"}</td>
                <td className={row.daysLeft !== null && row.daysLeft < 7 ? styles.expiring : undefined}>
                  {row.daysLeft ?? "—"}
                </td>
                <td>{outcomeLabel(row, t)}</td>
                <td>
                  <Button onClick={() => void reissue(row.domain)} disabled={reissuing === row.domain}>
                    {t("mixengine.domains.certs.reissue")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

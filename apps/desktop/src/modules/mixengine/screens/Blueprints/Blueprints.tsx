import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { BlueprintSummary } from "../../api/types/BlueprintSummary";
import CaptureDialog from "./CaptureDialog";
import ImportDialog from "./ImportDialog";
import ApplyDialog from "./ApplyDialog";
import styles from "./Blueprints.module.css";

/** Danh sách blueprint của home này — capture, nhập, apply. Không có sửa/xoá (`blueprint.delete`
 *  không tồn tại) — overwrite lúc capture/nhập là đường duy nhất thay một slug. */
export default function Blueprints({ active }: { active: boolean }) {
  const [rows, setRows] = useState<BlueprintSummary[]>([]);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState<BlueprintSummary | null>(null);
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const list = await api.blueprints();
      setRows(list.blueprints);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — cùng lý do `Dashboard.tsx`.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  function sourceLabel(row: BlueprintSummary): string {
    if (row.source === "builtin") return t("mixengine.blueprints.sourceBuiltin");
    if (row.source === "captured") return t("mixengine.blueprints.sourceCaptured");
    return t("mixengine.blueprints.sourceImported");
  }

  return (
    <div className={styles.blueprints}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className={styles.toolbar}>
        <Button onClick={() => setImporting(true)}>{t("mixengine.blueprints.importButton")}</Button>
        <Button variant="primary" onClick={() => setCapturing(true)}>
          {t("mixengine.blueprints.newButton")}
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("mixengine.blueprints.columnName")}</th>
              <th>{t("mixengine.blueprints.columnSource")}</th>
              <th>{t("mixengine.blueprints.columnDescription")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slug}>
                <td>
                  {row.name}{" "}
                  {row.trusted ? (
                    <span className={styles.trusted}>{t("mixengine.blueprints.trustedBadge")}</span>
                  ) : (
                    <span className={styles.untrusted}>
                      {t("mixengine.blueprints.untrustedBadge")}
                      {row.source === "imported" &&
                        row.signature === "rejected" &&
                        ` — ${t("mixengine.blueprints.signatureRejected")}`}
                    </span>
                  )}
                </td>
                <td>{sourceLabel(row)}</td>
                <td>{row.description}</td>
                <td className={styles.rowActions}>
                  <Button onClick={() => setApplying(row)}>
                    {t("mixengine.blueprints.applyButton")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className={styles.empty}>{t("mixengine.blueprints.empty")}</p>}

      {capturing && (
        <CaptureDialog
          onCancel={() => setCapturing(false)}
          onCaptured={() => {
            setCapturing(false);
            void reload();
          }}
        />
      )}

      {importing && (
        <ImportDialog
          onCancel={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void reload();
          }}
        />
      )}

      {applying && (
        <ApplyDialog
          blueprint={applying}
          onCancel={() => setApplying(null)}
          onDone={() => {
            setApplying(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

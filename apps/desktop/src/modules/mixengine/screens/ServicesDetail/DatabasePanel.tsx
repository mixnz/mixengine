import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Card from "../../../../components/Card";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import { copyText } from "../../../../core/clipboard";
import { errorMessage } from "../../../../core/errors";
import { CopyIcon, LockIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DatabaseClientReport } from "@mixengine/api";
import { createsDatabases, opensADatabase } from "./openChoices";
import styles from "./DatabasePanel.module.css";

/**
 * Những gì màn Services nói về một database — và **không nói gì cả về một service không phải
 * database**.
 *
 * *Mở* không ở đây nữa: nó là một hành động trên chính service, nên nó ở menu 3 chấm của hàng đó
 * trên Dashboard. Đứng cạnh nút Tạo, hai nút trả lời hai câu hỏi không liên quan bằng cùng một
 * hình dáng, và cái ô "Tên database" ở giữa thì thuộc về đúng một trong hai.
 */
export default function DatabasePanel({ service }: { service: string }) {
  const [report, setReport] = useState<DatabaseClientReport | null>(null);
  const [dbName, setDbName] = useState("");
  const [userName, setUserName] = useState("");
  const [createdMessage, setCreatedMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Lỗi của một hành động trong panel. Không giấu panel đi — việc Tạo hỏng không đổi việc service
   *  này vẫn là một database. */
  const [error, setError] = useState("");
  /** Lỗi của chính lần đọc `database.client`. Panel không biết mình có nên tồn tại hay không, nên
   *  nó hiện đúng câu đó và không hiện gì khác. */
  const [loadError, setLoadError] = useState("");
  const { t } = useTranslation();

  /**
   * Đọc `database.client` cho service đang chọn.
   *
   * **Xoá câu trả lời cũ trước khi hỏi câu mới, và bỏ qua câu trả lời về trễ.** Không làm điều thứ
   * nhất thì một lần đọc hỏng để nguyên `report` của service *trước đó* — chính là cách panel đã
   * hiện địa chỉ credential của `postgres@main` dưới tên `php-fpm@8.4.24`. Không làm điều thứ hai
   * thì bấm nhanh qua hai service sẽ để response của cái cũ hạ cánh sau và thắng, cùng đường đua
   * `readOrder.ts` mô tả cho bảng ở Dashboard.
   */
  useEffect(() => {
    let live = true;
    setReport(null);
    setError("");
    setLoadError("");
    setCreatedMessage("");
    setDbName("");
    setUserName("");

    void (async () => {
      try {
        const answer = await api.databaseClient(service);
        if (live) setReport(answer);
      } catch (e) {
        if (live) setLoadError(errorMessage(t, e));
      }
    })();

    return () => {
      live = false;
    };
  }, [service, t]);

  async function create() {
    setBusy(true);
    setError("");
    setCreatedMessage("");
    try {
      const account = await api.databaseCreate({
        service,
        database: dbName,
        user: userName.trim() === "" ? undefined : userName,
      });
      setCreatedMessage(
        account.made.database === "created"
          ? t("mixengine.servicesDetail.database.createdNew")
          : t("mixengine.servicesDetail.database.createdExisting"),
      );
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  // Hỏi mà không ra thì nói ra. Im lặng ở đây là một panel biến mất vì daemon không trả lời được,
  // và người đọc kết luận service này không phải database — một câu chưa ai nói.
  if (loadError !== "") {
    return <ErrorBanner message={loadError} onDismiss={() => setLoadError("")} />;
  }

  // Chưa đọc xong: chưa có gì để nói.
  if (report === null) return null;

  // **Không phải database thì không có panel nào cả.** `protocol: null` là một trạng thái daemon
  // trả lời cho nginx, caddy và mọi php-fpm pool — một dòng chữ giải thích rằng ở đây không có gì
  // vẫn là một khối chiếm chỗ nói rằng có.
  if (!opensADatabase(report)) return null;

  return (
    <Card headingLevel={3} title={t("mixengine.servicesDetail.database.title")}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className={styles.body}>
        {report.secret && (
          <div className={styles.secret}>
            <LockIcon size={14} className={styles.secretIcon} />
            <span className={styles.secretText}>
              {t("mixengine.servicesDetail.database.secretLine", { key: report.secret.key })}
            </span>
            <Button
              size="small"
              variant="ghost"
              aria-label={t("mixengine.servicesDetail.database.copyKey")}
              title={t("mixengine.servicesDetail.database.copyKey")}
              onClick={() => void copyText(report.secret?.key ?? "")}
            >
              <CopyIcon size={14} />
            </Button>
          </div>
        )}

        {/* Redis và MongoDB không tạo database kiểu này: daemon nói vậy, và một form chỉ có thể bị
            từ chối thì không vẽ (T155). */}
        {createsDatabases(report) && (
          <>
            <h4 className={styles.groupTitle}>{t("mixengine.servicesDetail.database.createTitle")}</h4>
            <div className={styles.fields}>
              <label className={styles.field}>
                {t("mixengine.servicesDetail.database.databaseName")}
                <Input mono value={dbName} disabled={busy} onChange={(e) => setDbName(e.target.value)} />
              </label>
              <label className={styles.field}>
                {t("mixengine.servicesDetail.database.userName")}
                {/* The daemon names the account after the database when none is given; the
                    placeholder says so as the database name is typed. */}
                <Input
                  mono
                  value={userName}
                  placeholder={dbName}
                  disabled={busy}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </label>
              <Button
                variant="primary"
                className={styles.create}
                onClick={() => void create()}
                disabled={busy || dbName.trim() === ""}
              >
                {t("mixengine.servicesDetail.database.create")}
              </Button>
            </div>

            {createdMessage !== "" && <p className={styles.created}>{createdMessage}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DatabaseClientReport } from "../../api/types/DatabaseClientReport";
import styles from "./DatabasePanel.module.css";

export default function DatabasePanel({ service }: { service: string }) {
  const [report, setReport] = useState<DatabaseClientReport | null>(null);
  const [dbName, setDbName] = useState("");
  const [userName, setUserName] = useState("");
  const [createdMessage, setCreatedMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setReport(await api.databaseClient(service));
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [service, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  async function open() {
    setBusy(true);
    setError("");
    try {
      await api.databaseOpenInMixDB(service, dbName.trim() === "" ? undefined : dbName);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (report === null) return null;

  return (
    <div className={styles.panel}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <h4>{t("mixengine.servicesDetail.database.title")}</h4>

      {report.protocol === null || report.protocol === undefined ? (
        <p className={styles.hint}>{t("mixengine.servicesDetail.database.notADatabaseService")}</p>
      ) : (
        <>
          {report.secret && (
            <p className={styles.hint}>
              {t("mixengine.servicesDetail.database.secretLine", { key: report.secret.key })}
            </p>
          )}

          <label className={styles.field}>
            {t("mixengine.servicesDetail.database.databaseName")}
            <Input value={dbName} disabled={busy} onChange={(e) => setDbName(e.target.value)} />
          </label>
          <label className={styles.field}>
            {t("mixengine.servicesDetail.database.userName")}
            <Input value={userName} disabled={busy} onChange={(e) => setUserName(e.target.value)} />
          </label>

          <div className={styles.actions}>
            <Button onClick={() => void create()} disabled={busy || dbName.trim() === ""}>
              {t("mixengine.servicesDetail.database.create")}
            </Button>

            {report.client.state === "installed" && (
              <Button variant="primary" onClick={() => void open()} disabled={busy}>
                {t("mixengine.servicesDetail.database.open")}
              </Button>
            )}
            {report.client.state === "not_installed" && (
              <p className={styles.hint}>
                {t("mixengine.servicesDetail.database.notInstalled", {
                  searched: report.client.searched,
                })}
              </p>
            )}
            {report.client.state === "no_client" && (
              <p className={styles.hint}>{t("mixengine.servicesDetail.database.noClient")}</p>
            )}
          </div>

          {createdMessage !== "" && <p className={styles.created}>{createdMessage}</p>}
        </>
      )}
    </div>
  );
}

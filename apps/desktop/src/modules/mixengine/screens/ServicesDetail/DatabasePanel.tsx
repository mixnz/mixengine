import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DatabaseClientReport } from "@mixengine/api";
import { DATABASE_MODULE_ID, openChoices } from "./openChoices";
import styles from "./DatabasePanel.module.css";

export default function DatabasePanel({
  service,
  isModuleVisible,
}: {
  service: string;
  /** Whether this window draws the built-in database client — T110. */
  isModuleVisible: (moduleId: string) => boolean;
}) {
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

  /* Open in this process: a `Handoff` and a tab request, which the shell turns into a `db` tab —
     and, when that module is hidden, turns the module on for it first (T110's D1). Which is why
     this function is the same one behind both built-in choices below. */
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

  /* The one *open* that leaves this process, offered only when the built-in client is hidden and
     the daemon named an application that is not this window — T110's D4. `user` is left out, so
     the daemon signs in as the server's administrator, which is the account the in-process path
     resolves through `database.client`'s `secret` too. */
  async function openExternally() {
    setBusy(true);
    setError("");
    try {
      await api.databaseOpen(service, dbName.trim() === "" ? undefined : dbName);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (report === null) return null;

  /* The *open* affordance — T110's D4. Drawn from `database.client` exactly as it always was, plus
     the one question the daemon knows nothing about: whether this window draws the built-in
     client. `clientName` is only ever read where there is a choice, and every choice is an
     `installed` client. */
  const builtInVisible = isModuleVisible(DATABASE_MODULE_ID);
  const choices = openChoices(report.client, builtInVisible);
  const clientName = report.client.state === "installed" ? report.client.name : "";

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

          {/* Why the button below says something else. Only where there is a button: with no
              client to open with at all, the sentence under it is already the whole story. */}
          {!builtInVisible && choices.length > 0 && (
            <p className={styles.hint}>{t("mixengine.servicesDetail.database.clientHidden")}</p>
          )}

          <div className={styles.actions}>
            <Button onClick={() => void create()} disabled={busy || dbName.trim() === ""}>
              {t("mixengine.servicesDetail.database.create")}
            </Button>

            {choices.includes("builtIn") && (
              <Button variant="primary" onClick={() => void open()} disabled={busy}>
                {t("mixengine.servicesDetail.database.open")}
              </Button>
            )}
            {/* The same call: turning the module on is the shell's, at the queue the request lands
                in. The label is what makes it an offer rather than a surprise. */}
            {choices.includes("builtInAfterEnabling") && (
              <Button variant="primary" onClick={() => void open()} disabled={busy}>
                {t("mixengine.servicesDetail.database.openEnabling")}
              </Button>
            )}
            {choices.includes("external") && (
              <Button onClick={() => void openExternally()} disabled={busy}>
                {t("mixengine.servicesDetail.database.openExternal", { name: clientName })}
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

import { useCallback, useEffect, useState } from "react";

import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { RuntimeExtension } from "../../api/types/RuntimeExtension";
import type { RuntimeTarget } from "../../api/types/RuntimeTarget";
import { poolBanner, type PoolBanner } from "../../runtimeState";
import styles from "./ExtensionsPanel.module.css";

export default function ExtensionsPanel({ target }: { target: RuntimeTarget }) {
  const [extensions, setExtensions] = useState<RuntimeExtension[]>([]);
  const [banner, setBanner] = useState<{ name: string; kind: PoolBanner } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setExtensions(await api.runtimeExtensions(target));
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t, target]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(name: string, enabled: boolean) {
    setBusy(name);
    setError("");
    try {
      const result = await api.runtimeSetExtension({ ...target, name, enabled });
      setExtensions((current) =>
        current.map((ext) => (ext.name === name ? result.extension : ext)),
      );
      const kind = poolBanner(result.pool);
      setBanner(kind === "none" ? null : { name, kind });
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.panel}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <h5>{t("mixengine.runtimes.extensions.title", { version: target.version })}</h5>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("mixengine.runtimes.extensions.columnName")}</th>
            <th>{t("mixengine.runtimes.extensions.columnEnabled")}</th>
          </tr>
        </thead>
        <tbody>
          {extensions.map((ext) => (
            <tr key={ext.name}>
              <td>{ext.name}</td>
              <td>
                {ext.linkage === "static" ? (
                  <span className={styles.static}>✓</span>
                ) : (
                  <input
                    type="checkbox"
                    checked={ext.enabled}
                    disabled={busy === ext.name}
                    onChange={(e) => void toggle(ext.name, e.target.checked)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {banner && banner.kind === "restartRequired" && (
        <p className={styles.banner}>{t("mixengine.runtimes.extensions.restartRequired")}</p>
      )}
      {banner && banner.kind === "appliesNextStart" && (
        <p className={styles.banner}>{t("mixengine.runtimes.extensions.appliesNextStart")}</p>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";

import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import Checkbox from "../../../../components/Checkbox";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { RuntimeExtension } from "@mixengine/api";
import type { RuntimeTarget } from "@mixengine/api";
import { poolBanner, type PoolBanner } from "../../runtimeState";
import styles from "./ExtensionsPanel.module.css";

export default function ExtensionsPanel({ target }: { target: RuntimeTarget }) {
  const [extensions, setExtensions] = useState<RuntimeExtension[]>([]);
  const [banner, setBanner] = useState<{ name: string; kind: PoolBanner } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const { t } = useTranslation();

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return extensions;
    return extensions.filter((ext) => ext.name.toLowerCase().includes(needle));
  }, [extensions, filter]);

  const reload = useCallback(async () => {
    try {
      setExtensions((await api.runtimeExtensions(target)).extensions);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t, target]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Emptied whenever another target is put on screen, so its extensions are not hidden by a
  // search typed against the version before.
  useEffect(() => {
    setFilter("");
  }, [target.kind, target.version]);

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
      <div className={styles.header}>
        <h5 className={styles.title}>
          {t("mixengine.runtimes.extensions.title", { version: target.version })}
        </h5>
        {filter.trim() !== "" && (
          <span className={styles.matchCount}>
            {shown.length}/{extensions.length}
          </span>
        )}
        <Input
          size="small"
          className={styles.filter}
          placeholder={t("mixengine.runtimes.extensions.search")}
          aria-label={t("mixengine.runtimes.extensions.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || filter === "") return;
            e.preventDefault();
            e.stopPropagation();
            setFilter("");
          }}
        />
      </div>
      <ul className={styles.list}>
        {shown.map((ext) => (
          <li key={ext.name}>
            <Checkbox
              className={styles.row}
              label={ext.name}
              checked={ext.enabled}
              disabled={ext.linkage === "static" || busy === ext.name}
              onChange={(e) => void toggle(ext.name, e.target.checked)}
            />
          </li>
        ))}
        {shown.length === 0 && filter.trim() !== "" && (
          <li className={styles.empty}>{t("mixengine.runtimes.extensions.noMatches")}</li>
        )}
      </ul>
      {banner && banner.kind === "restartRequired" && (
        <p className={styles.banner}>{t("mixengine.runtimes.extensions.restartRequired")}</p>
      )}
      {banner && banner.kind === "appliesNextStart" && (
        <p className={styles.banner}>{t("mixengine.runtimes.extensions.appliesNextStart")}</p>
      )}
    </div>
  );
}

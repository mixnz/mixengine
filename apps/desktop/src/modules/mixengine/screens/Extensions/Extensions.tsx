import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ExtensionOffer } from "@mixengine/api";
import type { ExtensionOrigin } from "@mixengine/api";
import type { ExtensionSummary } from "@mixengine/api";
import StaleBadge from "../../components/StaleBadge";
import Checkbox from "../../../../components/Checkbox";
import { serviceStateKey } from "../../serviceStateLabel";
import PlanDialog from "./PlanDialog";
import styles from "./Extensions.module.css";

/**
 * The registry offers this very application as an extension, and one of those rows **is** the
 * application running.
 *
 * Matched on `id` and not on `kind`: `desktop-app` is a sort of thing and not an identity, and
 * another desktop application appearing in the registry later is not the one drawing this screen.
 */
const SELF = "mixdb";

/**
 * The registry, what is installed, installing (from the registry or from a local directory),
 * removing, and starting or stopping an extension of `kind: "service"`.
 *
 * There is no "configure" screen — `extension.configure` does not exist (decision D1, spec).
 */
export default function Extensions({ active }: { active: boolean }) {
  const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
  const [available, setAvailable] = useState<ExtensionOffer[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [stale, setStale] = useState(false);
  const [serviceState, setServiceState] = useState<Record<string, string | null | undefined>>({});
  const [error, setError] = useState("");
  const [installingSource, setInstallingSource] = useState<ExtensionOrigin | null>(null);
  const [uninstalling, setUninstalling] = useState<ExtensionSummary | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  /* The running application's version, for the `mixdb` row. The registry states the version it
     *publishes*, and on a row that is this application itself that number answers a question
     nobody asked. `""` means the asking is not finished — a few milliseconds, and for those the
     row shows the registry's number rather than nothing at all. */
  const [appVersion, setAppVersion] = useState("");
  const { t } = useTranslation();

  useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [inst, avail, services] = await Promise.all([
        api.extensionsInstalled(),
        api.extensionsAvailable(),
        api.services(),
      ]);
      setInstalled(inst.extensions);
      setAvailable(avail.extensions);
      setUnreadable(avail.unreadable);
      setStale(avail.stale);
      const states: Record<string, string | null | undefined> = {};
      for (const svc of services.services) states[svc.id] = svc.state;
      setServiceState(states);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  // Read again on mount and on every return to this screen — the same reason `Dashboard.tsx` has.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  async function browseInstallFromPath() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setInstallingSource({ type: "path", path: picked });
  }

  /** `extension.*` and not `service.*` — see this plan's Global Constraints. */
  async function toggle(row: ExtensionSummary, action: "start" | "stop") {
    setError("");
    try {
      if (action === "start") await api.extensionStart(row.id);
      else await api.extensionStop(row.id);
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  async function confirmUninstall() {
    if (!uninstalling) return;
    setError("");
    try {
      await api.extensionUninstall({ id: uninstalling.id, delete_data: deleteData });
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      // **Closed either way.** This screen has no second question to ask on a refusal, and a
      // dialog kept up past its own answer is one nobody can see or dismiss — it has already
      // animated out. The banner behind it is where the refusal is read.
      setUninstalling(null);
      setDeleteData(false);
    }
  }


  /** The translated state; one nobody knows is shown as the daemon wrote it. See
   *  `serviceStateLabel.ts`. */
  function stateLabel(state: string | null | undefined): string {
    const key = serviceStateKey(state);
    return key === null ? (state ?? "—") : t(key);
  }

  /* MixDB sits under "installed" **not because the API says so** — the daemon reports it as not
     installed, and that is true in the daemon's own sense: it has never installed this
     application into any home. But the person reading this screen is running it. So the row is
     built from the application itself: name and kind from the registry where the registry has
     something to say, from the constants below where it has not; the version is always the
     running one.

     And it **appears exactly once**: filtered out of both lists first, then added back in one
     place. */
  const selfOffer = available.find((offer) => offer.id === SELF);
  const selfInstalled = installed.find((row) => row.id === SELF);
  const otherInstalled = installed.filter((row) => row.id !== SELF);
  const otherAvailable = available.filter((offer) => offer.id !== SELF);
  const selfName = selfInstalled?.name ?? selfOffer?.name ?? "MixDB";
  const selfKind = selfInstalled?.kind ?? selfOffer?.kind ?? "desktop-app";

  return (
    <div className={styles.extensions}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className={styles.toolbar}>
        <Button onClick={() => void browseInstallFromPath()}>
          {t("mixengine.extensions.installFromPath")}
        </Button>
      </div>

      <h4>{t("mixengine.extensions.installedTitle")}</h4>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("mixengine.extensions.columnName")}</th>
            <th>{t("mixengine.extensions.columnVersion")}</th>
            <th>{t("mixengine.extensions.columnKind")}</th>
            <th>{t("mixengine.extensions.columnState")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr key={SELF}>
            <td>{selfName}</td>
            {/* The running version, not the one the registry publishes — the two part company the
                moment the application updates itself. The registry stands in while `getVersion()`
                has yet to answer. */}
            <td>{appVersion || selfOffer?.version || "—"}</td>
            <td>{selfKind}</td>
            <td>—</td>
            <td className={styles.rowActions}>
              {/* No Remove button: an application cannot remove itself from inside itself, and
                  updating has a road of its own in Settings. */}
              <span className={styles.installedBadge}>{t("mixengine.extensions.thisApp")}</span>
            </td>
          </tr>
          {otherInstalled.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.version}</td>
              <td>{row.kind}</td>
              <td>{row.kind === "service" ? stateLabel(serviceState[row.id]) : "—"}</td>
              <td className={styles.rowActions}>
                {row.kind === "service" && (
                  <>
                    <Button onClick={() => void toggle(row, "start")}>
                      {t("mixengine.extensions.start")}
                    </Button>
                    <Button onClick={() => void toggle(row, "stop")}>
                      {t("mixengine.extensions.stop")}
                    </Button>
                  </>
                )}
                <Button onClick={() => setUninstalling(row)}>
                  {t("mixengine.extensions.uninstall")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>
        {t("mixengine.extensions.registryTitle")} <StaleBadge stale={stale} />
      </h4>
      {unreadable > 0 && (
        <p className={styles.hint}>{t("mixengine.extensions.unreadable", { count: unreadable })}</p>
      )}
      <table className={styles.table}>
        <tbody>
          {otherAvailable.map((offer) => (
            <tr key={offer.id}>
              <td>{offer.name}</td>
              <td>{offer.version}</td>
              <td>{offer.kind}</td>
              <td className={styles.rowActions}>
                {offer.installed ? (
                  <span className={styles.installedBadge}>{t("mixengine.extensions.installed")}</span>
                ) : (
                  <Button onClick={() => setInstallingSource({ type: "registry", id: offer.id })}>
                    {t("mixengine.extensions.install")}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {installingSource && (
        <PlanDialog
          source={installingSource}
          onCancel={() => setInstallingSource(null)}
          onInstalled={() => {
            setInstallingSource(null);
            void reload();
          }}
        />
      )}

      {uninstalling && (
        <ConfirmDialog
          title={t("mixengine.extensions.uninstallTitle", { name: uninstalling.name })}
          message={t("mixengine.extensions.uninstallMessage")}
          danger
          onCancel={() => {
            setUninstalling(null);
            setDeleteData(false);
          }}
          onConfirm={() => void confirmUninstall()}
        >
          <Checkbox
            className={styles.checkbox}
            label={t("mixengine.extensions.deleteData")}
            checked={deleteData}
            onChange={(e) => setDeleteData(e.target.checked)}
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

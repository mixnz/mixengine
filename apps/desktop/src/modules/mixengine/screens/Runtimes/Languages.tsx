import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import Input from "../../../../components/Input";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { RuntimeRelease } from "@mixengine/api";
import type { RuntimeSummary } from "@mixengine/api";
import { applyJob, type JobRow } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import { afterRefusal } from "../../forceStep";
import { takePendingRuntimesFilter } from "../../runtimesNavigation";
import { formatInstalledAt, jobFinished, jobFor, versionKey } from "../../runtimeState";
import StaleBadge from "../../components/StaleBadge";
import { matchesAvailable } from "./availableFilter";
import ExtensionsPanel from "./ExtensionsPanel";
import styles from "./Languages.module.css";

export default function Languages({ active }: { active: boolean }) {
  const [installed, setInstalled] = useState<RuntimeSummary[]>([]);
  const [available, setAvailable] = useState<RuntimeRelease[]>([]);
  const [stale, setStale] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [installingJob, setInstallingJob] = useState<Record<string, number>>({});
  const [uninstallTarget, setUninstallTarget] = useState<RuntimeSummary | null>(null);
  const [forceHint, setForceHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Filters the "not installed" table only — the same reason `Packages.tsx` has.
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const { t } = useTranslation();

  // Reads the latest `installingJob` from inside a `watch` callback registered once — the effect
  // below has no `installingJob` in its deps (re-registering the watch every time that map
  // changes buys nothing).
  const installingJobRef = useRef(installingJob);
  useEffect(() => {
    installingJobRef.current = installingJob;
  }, [installingJob]);

  // `stillShow` is the error that has to survive this reload. A failed install job still has to
  // be told even when the read right after it answers normally: a read that works says nothing
  // about whether the install finished. Empty — the default — means "a finished read leaves the
  // screen clean", exactly as before.
  const reload = useCallback(
    async (stillShow = "") => {
      try {
        const [inst, avail] = await Promise.all([api.runtimesInstalled(), api.runtimesAvailable()]);
        setInstalled(inst.runtimes);
        setAvailable(avail.runtimes);
        setStale(avail.stale);
        setError(stillShow);
      } catch (e) {
        setError(errorMessage(t, e));
      }
    },
    [t],
  );

  // Read again on mount and on every return to this tab — the same reason `Dashboard.tsx` has.
  // Kept out of the watch effect below: the watch has to live for the component's whole life (an
  // install job still has to be followed while the user is over in Packages or another screen),
  // while the reload only has to run while the screen is *being looked at*.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  // A navigation request from `runtimesNavigation.ts` — "Install a PHP" on the PHP extensions
  // screen means "open Runtimes already searching for php", and the search box lives here. Read on
  // the `active` edge rather than on mount: this component stays mounted between visits, so mount
  // happens once while the request can arrive any number of times afterwards.
  useEffect(() => {
    if (!active) return;
    const requested = takePendingRuntimesFilter();
    if (requested !== null) setFilter(requested);
  }, [active]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      setJobs((current) => applyJob(current, raw));
      // A job being followed has just finished: the "installed" table does not learn of the new
      // build unless it reads again — no other API carries this news (T3, `daemonState.ts`: an
      // event is never the only path, but here it is the *first* one, and reopening the tab
      // stays the fallback).
      const finished = jobFinished(raw);
      if (finished !== null && Object.values(installingJobRef.current).includes(finished.id)) {
        // When a job fails, `job_finished` is the only place that says why — see `jobFinished`.
        // The reload still has to run (a job that failed partway may well have changed
        // something), but it may not wipe out the sentence that has just arrived.
        void reload(finished.error === null ? "" : errorMessage(t, finished.error));
        setInstallingJob((current) => {
          const next = { ...current };
          for (const key of Object.keys(next)) {
            if (next[key] === finished.id) delete next[key];
          }
          return next;
        });
      }
    });
  }, [reload, t]);

  async function install(release: RuntimeRelease) {
    setError("");
    try {
      const job = await api.runtimeInstall({ kind: release.kind, version: release.version });
      setInstallingJob((current) => ({
        ...current,
        [versionKey(release.kind, release.version)]: job.id,
      }));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  async function uninstall(target: RuntimeSummary, force: boolean) {
    setError("");
    try {
      await api.runtimeUninstall({ kind: target.kind, version: target.version, force });
      setUninstallTarget(null);
      setForceHint(null);
      void reload();
    } catch (e) {
      // No `force` sent yet and the refusal is a project pin: ask again with `force`, showing the
      // message the daemon wrote — it names the project — rather than one made up here.
      const step = afterRefusal(force, errorMessage(t, e));

      if (step.ask === "force") {
        setForceHint(step.hint);
        return;
      }

      // Closed on the way out: a dialog left up once there is nothing left to ask is a dialog
      // holding the screen with nothing to say. See `forceStep.ts`.
      setUninstallTarget(null);
      setForceHint(null);
      setError(step.error);
    }
  }

  async function setDefault(target: RuntimeSummary) {
    setError("");
    try {
      await api.runtimeSetDefault({ kind: target.kind, version: target.version });
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  const shownAvailable = available.filter(
    (release) =>
      !release.installed &&
      matchesAvailable([release.kind, release.version, release.channel], filter),
  );

  return (
    <div className={styles.languages}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("mixengine.runtimes.columnVersion")}</th>
            <th>{t("mixengine.runtimes.columnChannel")}</th>
            <th>{t("mixengine.runtimes.columnInstalledAt")}</th>
            <th>{t("mixengine.runtimes.columnDefault")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {installed.map((row) => {
            const key = versionKey(row.kind, row.version);
            return (
              <Fragment key={key}>
                <tr>
                  <td>
                    <button
                      className={styles.versionButton}
                      onClick={() => setExpanded(expanded === key ? null : key)}
                    >
                      {row.kind} {row.version}
                    </button>
                  </td>
                  <td>{row.channel}</td>
                  <td>{formatInstalledAt(row.installed_at)}</td>
                  <td>{row.default ? "✓" : "—"}</td>
                  <td className={styles.actions}>
                    {!row.default && (
                      <Button onClick={() => void setDefault(row)}>
                        {t("mixengine.runtimes.setDefault")}
                      </Button>
                    )}
                    <Button onClick={() => setUninstallTarget(row)}>
                      {t("mixengine.runtimes.uninstall")}
                    </Button>
                  </td>
                </tr>
                {expanded === key && row.kind === "php" && (
                  <tr>
                    <td colSpan={5}>
                      <ExtensionsPanel target={{ kind: row.kind, version: row.version }} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className={styles.availableHeader}>
        <h4 className={styles.availableTitle}>
          {t("mixengine.runtimes.columnVersion")} <StaleBadge stale={stale} />
        </h4>
        <Input
          size="small"
          allowClear
          className={styles.filter}
          placeholder={t("mixengine.runtimes.searchAvailable")}
          aria-label={t("mixengine.runtimes.searchAvailable")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears the search and stops here — it must not bubble up and close the tab.
            if (e.key !== "Escape" || filter === "") return;
            e.preventDefault();
            e.stopPropagation();
            setFilter("");
          }}
        />
      </div>
      <table className={styles.table}>
        <tbody>
          {shownAvailable.map((release) => {
            const key = versionKey(release.kind, release.version);
            const job = jobFor(jobs, installingJob[key]);
            return (
              <tr key={key}>
                <td>
                  {release.kind} {release.version}
                </td>
                <td>{release.channel}</td>
                <td className={styles.actions}>
                  {job ? (
                    <span className={styles.progress}>
                      <progress value={job.percent} max={100} />
                      {job.message}
                    </span>
                  ) : (
                    <Button onClick={() => void install(release)}>
                      {t("mixengine.runtimes.install")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shownAvailable.length === 0 && filter.trim() !== "" && (
        <p className={styles.noMatches}>{t("mixengine.runtimes.noMatches")}</p>
      )}

      {uninstallTarget && (
        <ConfirmDialog
          title={t("mixengine.runtimes.uninstallConfirmTitle", { version: uninstallTarget.version })}
          message={forceHint ?? uninstallTarget.version}
          confirmLabel={
            forceHint !== null ? t("mixengine.runtimes.uninstallForceConfirm") : undefined
          }
          danger
          onCancel={() => {
            setUninstallTarget(null);
            setForceHint(null);
          }}
          onConfirm={() => void uninstall(uninstallTarget, forceHint !== null)}
        />
      )}
    </div>
  );
}

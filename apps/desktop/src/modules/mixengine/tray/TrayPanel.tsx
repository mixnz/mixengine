import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SiteSummary } from "@mixengine/api";

import ActionBar from "../../../components/ActionBar";
import Button from "../../../components/Button";
import ErrorBanner from "../../../components/ErrorBanner";
import MonogramBadge from "../../../components/MonogramBadge";
import StatusPill, { type StatusTone } from "../../../components/StatusPill";
import { errorMessage } from "../../../core/errors";
import { hideTrayPanel, openMainWindow, quitApp } from "../../../core/window";
import { PlayIcon, PowerIcon, StopIcon } from "../../../icons";
import { useTranslation } from "../../../i18n";
import * as api from "../api";
import { applyEvent, needsResync, rowsFrom, type ServiceRow } from "../daemonState";
import { ensureDaemonWatch, subscribeDaemonWatch } from "../daemonWatch";
import { serviceStateKey, serviceStateTone, toggleMode } from "../serviceStateLabel";
import { siteVisit } from "../siteState";
import { isFree } from "../storagePicker";
import {
  CONFIRM_TIMEOUT_MS,
  nextConfirm,
  serviceCounts,
  shutdownReport,
  type Confirmable,
  type ConfirmEvent,
  type ShutdownReport,
} from "./trayModel";
import styles from "./TrayPanel.module.css";

/**
 * The tray panel — T168, the spec's D3. What the Dashboard would say about this machine, in 360
 * pixels: the daemon, its services with Start and Stop, *Stop all*, the sites, and the way into
 * MixLab and out of MixEngine.
 *
 * **It keeps nothing the Dashboard does not.** Every show reads `service.list` and `site.list`
 * again, and the event stream moves rows in between — the same `applyEvent` the Dashboard runs.
 */
function TrayPanel() {
  const { t } = useTranslation();
  const [presence, setPresence] = useState<api.Presence | null>(null);
  const [setupFree, setSetupFree] = useState(false);
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [busy, setBusy] = useState<Record<string, api.ServiceAction>>({});
  const [working, setWorking] = useState<Confirmable | "start" | null>(null);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);
  const [report, setReport] = useState<ShutdownReport | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const answer = await api.presence();
      setPresence(answer.presence);
      if (answer.presence === "running") {
        ensureDaemonWatch();
        const [list, siteList] = await Promise.all([api.services(), api.sites()]);
        setRows(rowsFrom(list.services));
        setSites(siteList.sites);
        setSetupFree(false);
      } else {
        setRows([]);
        setSites([]);
        // A home that never started still has its storage choice to make, and that is a screen of
        // MixLab's, not a question for a panel this size.
        setSetupFree(
          answer.presence === "notRunning" &&
            (await api.storage().then(isFree).catch(() => false)),
        );
      }
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  const dispatchConfirm = useCallback((event: ConfirmEvent) => {
    setConfirm((current) => nextConfirm(current, event));
    if (event.type === "arm") {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => setConfirm((current) => nextConfirm(current, { type: "timeout", key: event.key })),
        CONFIRM_TIMEOUT_MS,
      );
    }
  }, []);

  /* Read again every time the panel comes up, and put any open question away when it goes: a
     question left armed behind a hidden window would be answered by the next click on it. */
  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let live = true;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          setReport(null);
          void refresh();
        } else {
          dispatchConfirm({ type: "hide" });
        }
      })
      .then((stop) => {
        if (live) unlisten = stop;
        else stop();
      });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [refresh, dispatchConfirm]);

  useEffect(
    () =>
      subscribeDaemonWatch((raw) => {
        if (needsResync(raw)) void refresh();
        setRows((current) => applyEvent(current, raw).rows);
      }),
    [refresh],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") void hideTrayPanel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function act(id: string, action: api.ServiceAction) {
    setBusy((current) => ({ ...current, [id]: action }));
    try {
      await api.serviceAction(id, action);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    await refresh();
  }

  async function perform(what: Confirmable | "start", run: () => Promise<void>) {
    dispatchConfirm({ type: "cancel" });
    setWorking(what);
    setError("");
    try {
      await run();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setWorking(null);
    }
    await refresh();
  }

  async function visit(site: SiteSummary) {
    const { startProject, url } = siteVisit(site);
    try {
      if (startProject !== null) await api.serviceStartProject(startProject);
      await openUrl(url);
      await hideTrayPanel();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  function pillTone(row: ServiceRow): StatusTone {
    const tone = serviceStateTone(row.state, row.stoppedBy);
    if (tone === "ok") return "success";
    if (tone === "bad") return "danger";
    if (tone === "busy") return "warning";
    return "neutral";
  }

  function stateLabel(row: ServiceRow): string {
    const key = serviceStateKey(row.state, row.stoppedBy);
    return key === null ? (row.state ?? "—") : t(key);
  }

  const running = presence === "running";
  const counts = serviceCounts(rows);

  function confirmRow(key: Confirmable, label: string, question: string, onConfirm: () => void) {
    if (confirm === key) {
      return (
        <div className={styles.confirm} role="group" aria-label={question}>
          <span className={styles.question}>{question}</span>
          <Button size="small" onClick={() => dispatchConfirm({ type: "cancel" })}>
            {t("mixengine.tray.cancel")}
          </Button>
          <Button size="small" variant="danger" onClick={onConfirm}>
            {t("mixengine.tray.confirm")}
          </Button>
        </div>
      );
    }
    return (
      <Button
        size="small"
        variant={key === "shutdown" ? "danger" : "default"}
        busy={working === key ? t("mixengine.dashboard.stopping") : undefined}
        disabled={working !== null}
        onClick={() => dispatchConfirm({ type: "arm", key })}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className={styles.panel} data-density="compact">
      <header className={styles.header}>
        <img className={styles.logo} src="/logo.svg" alt="" width={28} height={28} />
        <div className={styles.brand}>
          <span className={styles.name}>MixEngine</span>
          <span className={styles.slogan}>{t("mixengine.tray.slogan")}</span>
        </div>
      </header>

      <div className={styles.body}>
        {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

        <section className={styles.summary}>
          {presence === null ? null : running ? (
            <>
              <StatusPill tone="success">{t("mixengine.tray.running")}</StatusPill>
              <span className={styles.counts}>
                {t("mixengine.tray.counts", { up: counts.up, total: counts.total })}
              </span>
            </>
          ) : (
            <>
              <p className={styles.state}>
                {presence === "notRunning" ? t("mixengine.tray.stopped") : t(`mixengine.gate.${presence}`)}
              </p>
              {presence === "notRunning" &&
                (setupFree ? (
                  <Button size="small" variant="primary" onClick={() => void openMainWindow()}>
                    {t("mixengine.tray.setUp")}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    variant="primary"
                    busy={working === "start" ? t("mixengine.gate.starting") : undefined}
                    onClick={() =>
                      void perform("start", async () => {
                        await api.startDaemon();
                      })
                    }
                  >
                    {t("mixengine.gate.start")}
                  </Button>
                ))}
              {presence !== "notRunning" && (
                <Button size="small" onClick={() => void openMainWindow()}>
                  {t("mixengine.tray.openMain")}
                </Button>
              )}
            </>
          )}
          {report !== null && (
            <div className={styles.report} role="status">
              <p>{t("mixengine.tray.shutdownDone", { count: report.stopped })}</p>
              {report.failed !== null && (
                <p>{t("mixengine.tray.shutdownFailed", { service: report.failed })}</p>
              )}
              {report.unordered !== null && (
                <p>{t("mixengine.tray.unordered", { message: report.unordered })}</p>
              )}
            </div>
          )}
        </section>

        {running && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.title}>{t("mixengine.tray.services")}</h2>
              {counts.up > 0 &&
                confirmRow(
                  "stopAll",
                  t("mixengine.tray.stopAll"),
                  t("mixengine.tray.confirmStopAll", { count: counts.up }),
                  () =>
                    void perform("stopAll", async () => {
                      await api.serviceStopAll();
                    }),
                )}
            </div>
            {rows.length === 0 ? (
              <p className={styles.empty}>{t("mixengine.tray.noServices")}</p>
            ) : (
              <ul className={styles.list}>
                {rows.map((row) => {
                  const pending = busy[row.id];
                  const mode = toggleMode(row.state, pending !== undefined);
                  return (
                    <li key={row.id} className={styles.row}>
                      <MonogramBadge name={row.id} size={28} />
                      <span className={styles.rowName} title={row.id}>
                        {row.id}
                      </span>
                      <StatusPill tone={pending ? "warning" : pillTone(row)} pulse={mode === "moving"}>
                        {pending
                          ? t(pending === "stop" ? "mixengine.dashboard.stopping" : "mixengine.dashboard.starting")
                          : stateLabel(row)}
                      </StatusPill>
                      {mode === "up" ? (
                        <Button
                          size="small"
                          aria-label={t("mixengine.dashboard.stopService", { service: row.id })}
                          onClick={() => void act(row.id, "stop")}
                        >
                          <StopIcon size={11} />
                          {t("mixengine.dashboard.stop")}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="positive"
                          disabled={mode === "moving"}
                          aria-label={t("mixengine.dashboard.startService", { service: row.id })}
                          onClick={() => void act(row.id, "start")}
                        >
                          <PlayIcon size={11} />
                          {t("mixengine.dashboard.start")}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {running && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.title}>{t("mixengine.tray.sites")}</h2>
            </div>
            {sites.length === 0 ? (
              <p className={styles.empty}>{t("mixengine.tray.noSites")}</p>
            ) : (
              <ul className={styles.list}>
                {sites.map((site) => (
                  <li key={site.domain} className={styles.site}>
                    <Button variant="link" size="small" title={site.domain} onClick={() => void visit(site)}>
                      {site.domain}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <Button size="small" variant="primary" onClick={() => void openMainWindow()}>
          {t("mixengine.tray.openMain")}
        </Button>
        {running &&
          confirmRow(
            "shutdown",
            t("mixengine.tray.shutdown"),
            t("mixengine.tray.confirmShutdown", { count: counts.up }),
            () =>
              void perform("shutdown", async () => {
                setReport(shutdownReport(await api.shutdown()));
              }),
          )}
        <ActionBar
          className={styles.quit}
          actions={[
            {
              key: "quit",
              icon: PowerIcon,
              label: t("mixengine.tray.quit"),
              onClick: () => void quitApp(),
            },
          ]}
        />
      </footer>
    </div>
  );
}

export default TrayPanel;

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
import { IS_MAC, IS_WINDOWS } from "../../../core/platform";
import { hideTrayPanel, openMainWindow, quitApp } from "../../../core/window";
import { ChevronRightIcon, GlobeIcon, LockIcon, PlayIcon, PowerIcon, StopIcon } from "../../../icons";
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

/* The popover slides in from the right on the two systems where it is one. On Linux it is an
   ordinary window the window manager placed, and content sliding about inside it would look broken. */
const SLIDES = IS_MAC || IS_WINDOWS;

/** How often an open panel asks whether a daemon has come up elsewhere — MixLab's Start, `mix`. */
const POLL_MS = 2000;

/** The slide out, to the millisecond of `TrayPanel.module.css`'s exit transition. */
const SLIDE_OUT_MS = 420;

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
  /* Off to the right until the window is focused, and back there the moment it is not — so that
     the next show starts from the edge instead of flashing where it was. */
  const [shown, setShown] = useState(!SLIDES);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* The hide waiting for the slide out to finish — cancelled when the panel is shown again before
     it has, so a quick re-open is not hidden from under the person. */
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Put the panel away: slide the card out, and only then hide the window. Hiding first would
   * leave the card where it was in the window's last frame, and the next show would flash it in
   * place before sliding it in. On Linux there is no slide, so the window goes at once.
   */
  const dismiss = useCallback(() => {
    if (!SLIDES) {
      void hideTrayPanel();
      return;
    }
    if (leaving.current !== null) return;
    setShown(false);
    leaving.current = setTimeout(() => {
      leaving.current = null;
      void hideTrayPanel();
    }, SLIDE_OUT_MS);
  }, []);

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
          if (leaving.current !== null) {
            clearTimeout(leaving.current);
            leaving.current = null;
          }
          setReport(null);
          void refresh();
          // One frame at the edge first, or the browser skips straight to the end of the slide.
          if (SLIDES) requestAnimationFrame(() => setShown(true));
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

  /* Stopped here and started from MixLab or `mix` while the panel is open: nothing else would tell
     it, because a stopped daemon has no event stream to send the news on. */
  useEffect(() => {
    if (!shown || presence === null || presence === "running") return;
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(poll);
  }, [shown, presence, refresh]);

  useEffect(
    () =>
      subscribeDaemonWatch((raw) => {
        if (needsResync(raw)) void refresh();
        setRows((current) => applyEvent(current, raw).rows);
      }),
    [refresh],
  );

  /* Every way the panel goes — a click elsewhere, a click on the icon, Open MixLab — arrives from
     `src-tauri/src/tray.rs` as this one event, so all of them slide out the same way. */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let live = true;
    void getCurrentWindow()
      .listen("tray://dismiss", dismiss)
      .then((stop) => {
        if (live) unlisten = stop;
        else stop();
      });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [dismiss]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (leaving.current !== null) clearTimeout(leaving.current);
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
      dismiss();
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

  function armButton(key: Confirmable, label: string, variant: "default" | "danger", size: "small" | "normal") {
    return (
      <Button
        size={size}
        variant={variant}
        busy={working === key ? t("mixengine.dashboard.stopping") : undefined}
        disabled={working !== null && working !== key}
        onClick={() => dispatchConfirm({ type: "arm", key })}
      >
        {label}
      </Button>
    );
  }

  function confirmNow() {
    if (confirm === "shutdown") {
      void perform("shutdown", async () => {
        setReport(shutdownReport(await api.shutdown()));
      });
    }
  }

  const question = confirm === "shutdown" ? t("mixengine.tray.confirmShutdown") : null;

  return (
    <div className={styles.stage} data-slides={SLIDES || undefined}>
      <div className={`${styles.panel} ${shown ? styles.shown : ""}`} data-density="compact">
        <header className={styles.header}>
          <img className={styles.logo} src="/logo.svg" alt="" width={32} height={32} />
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
                    <Button variant="primary" onClick={() => void openMainWindow()}>
                      {t("mixengine.tray.setUp")}
                    </Button>
                  ) : (
                    <Button
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
                {/* No question first, as on the Dashboard: the services start again with a click. */}
                {counts.up > 0 && (
                  <Button
                    size="small"
                    busy={working === "stopAll" ? t("mixengine.dashboard.stopping") : undefined}
                    disabled={working !== null && working !== "stopAll"}
                    onClick={() =>
                      void perform("stopAll", async () => {
                        await api.serviceStopAll();
                      })
                    }
                  >
                    {t("mixengine.tray.stopAll")}
                  </Button>
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
                        <MonogramBadge name={row.id} size={30} />
                        <div className={styles.rowText}>
                          <span className={styles.rowName} title={row.id}>
                            {row.id}
                          </span>
                          <StatusPill
                            className={styles.rowState}
                            tone={pending ? "warning" : pillTone(row)}
                            pulse={mode === "moving"}
                          >
                            {pending
                              ? t(pending === "stop" ? "mixengine.dashboard.stopping" : "mixengine.dashboard.starting")
                              : stateLabel(row)}
                          </StatusPill>
                        </div>
                        {mode === "up" ? (
                          <Button
                            size="small"
                            className={styles.toggle}
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
                            className={styles.toggle}
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
                  {sites.map((site) => {
                    const SchemeIcon = site.https ? LockIcon : GlobeIcon;
                    return (
                      <li key={site.domain}>
                        <Button
                          variant="ghost"
                          className={styles.site}
                          title={t("mixengine.tray.openSite", { domain: site.domain })}
                          onClick={() => void visit(site)}
                        >
                          <SchemeIcon size={14} className={styles.siteIcon} />
                          <span className={styles.siteName}>{site.domain}</span>
                          <ChevronRightIcon size={14} className={styles.siteGo} />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* One strip at the bottom either way: the three ways out, or the question the last
            click asked — never both squeezed onto one line. */}
        {question !== null ? (
          <footer className={`${styles.footer} ${styles.asking}`} role="group" aria-label={question}>
            <span className={styles.question}>{question}</span>
            <Button onClick={() => dispatchConfirm({ type: "cancel" })}>{t("mixengine.tray.cancel")}</Button>
            <Button variant="danger" onClick={confirmNow}>
              {t("mixengine.tray.confirm")}
            </Button>
          </footer>
        ) : (
          <footer className={styles.footer}>
            <Button variant="primary" className={styles.footerAction} onClick={() => void openMainWindow()}>
              {t("mixengine.tray.openMain")}
            </Button>
            {running ? (
              <span className={styles.footerAction}>
                {armButton("shutdown", t("mixengine.tray.shutdown"), "danger", "normal")}
              </span>
            ) : (
              <span className={styles.footerAction} />
            )}
            <ActionBar
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
        )}
      </div>
    </div>
  );
}

export default TrayPanel;

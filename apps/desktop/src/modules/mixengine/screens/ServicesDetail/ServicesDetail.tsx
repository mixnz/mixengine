import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import EmptyState from "../../../../components/EmptyState";
import ErrorBanner from "../../../../components/ErrorBanner";
import MonogramBadge from "../../../../components/MonogramBadge";
import PageHeader from "../../../../components/PageHeader";
import StatusPill, { type StatusTone } from "../../../../components/StatusPill";
import { PlusIcon, TrashIcon } from "../../../../icons";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ServiceCreation, ServiceSummary } from "@mixengine/api";
import { movesARow, needsResync } from "../../daemonState";
import { subscribeDaemonWatch } from "../../daemonWatch";
import { serviceStateKey, serviceStateTone } from "../../serviceStateLabel";
import { afterRefusal } from "../../forceStep";
import ServiceForm from "../../components/ServiceForm";
import AutostartPanel from "./AutostartPanel";
import DatabasePanel from "./DatabasePanel";
import IdlePanel from "./IdlePanel";
import LimitsPanel from "./LimitsPanel";
import styles from "./ServicesDetail.module.css";

/** `mysql@main` → `mysql`; an id with no instance is its own name. */
function serviceName(id: string): string {
  const at = id.indexOf("@");
  return at < 0 ? id : id.slice(0, at);
}

/** `mysql@main` → `@main`, drawn quieter beside the name. */
function serviceInstance(id: string): string {
  const at = id.indexOf("@");
  return at < 0 ? "" : id.slice(at);
}

/** The state as a pill tone: whether it is serving, not which of the seven states it is in. */
function pillTone(state: string | null | undefined): StatusTone {
  const tone = serviceStateTone(state);
  if (tone === "ok") return "success";
  if (tone === "bad") return "danger";
  if (tone === "busy") return "warning";
  return "neutral";
}

/** The same answer for the small dot in a list row. */
function dotTone(state: string | null | undefined): "dotSuccess" | "dotDanger" | "dotWarning" | "dotNeutral" {
  const tone = pillTone(state);
  return tone === "success" ? "dotSuccess" : tone === "danger" ? "dotDanger" : tone === "warning" ? "dotWarning" : "dotNeutral";
}

export default function ServicesDetail({ active }: { active: boolean }) {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** A service just created did not get the port its recipe wanted. See `PortMoved`: true of this
   *  moment and of nothing else. */
  const [moved, setMoved] = useState<ServiceCreation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [forceHint, setForceHint] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const list = await api.services();
      setServices(list.services);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  // Read again on mount and on every return to this screen — installing or removing a runtime (a
  // PHP build, say) raises no event this screen would hear, and the screen stays mounted across a
  // change of screen, so it no longer gets "remount = a fresh read" for free; coming back to the
  // tab is the fallback, see `Dashboard.tsx`.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  // The dot beside each row is the service's real state, so a change of state reads the list again.
  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      if (movesARow(raw) || needsResync(raw)) void reload();
    });
  }, [reload]);

  /** Trạng thái đã dịch; một trạng thái daemon mới hơn build này hiện nguyên văn. */
  function stateLabel(state: string | null | undefined): string {
    const key = serviceStateKey(state);
    return key === null ? (state ?? "—") : t(key);
  }

  /* Select the service just created: whoever stood it up is about to set its limits and idle. */
  function created(creation: ServiceCreation) {
    setCreating(false);
    setSelected(creation.service.id);
    setMoved(creation.moved_from == null ? null : creation);
    void reload();
  }

  /** The "it is not on the port you think" sentence, in the three cases `PortMoved` tells apart. */
  function movedNotice(creation: ServiceCreation): string {
    const from = creation.moved_from;
    if (from == null) return "";
    const holder =
      from.program == null
        ? t("mixengine.servicesDetail.movedByUnknown", { preferred: from.preferred })
        : from.pid == null
          ? t("mixengine.servicesDetail.movedByProgram", {
              preferred: from.preferred,
              program: from.program,
            })
          : t("mixengine.servicesDetail.movedBy", {
              preferred: from.preferred,
              program: from.program,
              pid: from.pid,
            });
    return `${t("mixengine.servicesDetail.movedTo", {
      service: creation.service.id,
      port: creation.service.port ?? "?",
    })} ${holder}`;
  }

  async function deleteService(id: string, force: boolean) {
    setError("");
    try {
      await api.serviceDelete({ service: id, force });
      setDeleteTarget(null);
      setForceHint(null);
      if (selected === id) setSelected(null);
      void reload();
    } catch (e) {
      // The same rule `runtime.uninstall` follows in Languages.tsx: the first attempt sends no
      // `force`, and the refusal names the sites declaring this service — so the dialog asks again
      // with the daemon's own sentence rather than one of its own.
      const step = afterRefusal(force, errorMessage(t, e));

      if (step.ask === "force") {
        setForceHint(step.hint);
        return;
      }

      // **Closed, because there is nothing left to ask.** A forced attempt can still be refused
      // for a reason force never crosses — a running service — and a dialog left up on that is a
      // dialog on screen with nothing to say.
      setDeleteTarget(null);
      setForceHint(null);
      setError(step.error);
    }
  }

  const current = services.find((service) => service.id === selected);

  return (
    <div className={styles.screen}>
      <div className={styles.list}>
        <div className={styles.listHead}>
          <h2 className={styles.listTitle}>{t("mixengine.sidebar.servicesDetail")}</h2>
          <span className={styles.count}>{services.length}</span>
        </div>
        <Button className={styles.newService} onClick={() => setCreating(true)}>
          <PlusIcon size={14} />
          {t("mixengine.serviceForm.newService")}
        </Button>
        <div className={styles.rows}>
          {services.map((service) => (
            // A plain `<button>` per row, as the module sidebar beside it: `ItemList` draws a
            // single line of text and has no room for the badge and the state under the name.
            <button
              key={service.id}
              type="button"
              className={styles.row}
              aria-current={service.id === selected ? "true" : undefined}
              onClick={() => setSelected(service.id)}
            >
              <MonogramBadge name={service.id} size={30} />
              <span className={styles.rowText}>
                <span className={styles.rowName}>
                  {serviceName(service.id)}
                  <span className={styles.instance}>{serviceInstance(service.id)}</span>
                </span>
                <span className={styles.rowState}>
                  <span className={`${styles.dot} ${styles[dotTone(service.state)]}`} aria-hidden="true" />
                  {stateLabel(service.state)}
                </span>
              </span>
            </button>
          ))}
          {services.length === 0 && <p className={styles.listEmpty}>{t("mixengine.servicesDetail.noServices")}</p>}
        </div>
      </div>

      <div className={styles.detail}>
        {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        {selected === null ? (
          <EmptyState title={t("mixengine.servicesDetail.pickService")} />
        ) : (
          <>
            <PageHeader
              leading={<MonogramBadge name={selected} size={50} />}
              title={selected}
              badges={
                current !== undefined && (
                  <StatusPill tone={pillTone(current.state)}>{stateLabel(current.state)}</StatusPill>
                )
              }
              meta={
                current !== undefined && (
                  <span className={styles.meta}>
                    {current.role?.role === "front_end" && (
                      <span className={styles.tag}>{t("mixengine.servicesDetail.frontEnd")}</span>
                    )}
                    {current.port != null && (
                      <span className={styles.port}>{t("mixengine.servicesDetail.port", { port: current.port })}</span>
                    )}
                  </span>
                )
              }
              actions={
                <Button variant="danger" onClick={() => setDeleteTarget(selected)}>
                  <TrashIcon size={14} />
                  {t("mixengine.servicesDetail.delete")}
                </Button>
              }
            />
            {moved !== null && moved.service.id === selected && (
              <p className={styles.notice} role="status">
                {movedNotice(moved)}
              </p>
            )}
            {/* Đầu tiên, và **không vẽ gì cả** cho một service không phải database — nên với
                nginx hay một php-fpm pool, cái đầu tiên đọc được vẫn là Autostart. Nó đứng trên
                vì nó là thứ riêng của service này, còn ba panel dưới hỏi cùng một câu cho mọi
                service. */}
            <DatabasePanel service={selected} />
            {/* Cạnh nhau và theo thứ tự này: autostart trả lời "cái gì đang chạy khi tôi ngồi
                xuống", idle trả lời "cái gì còn chạy khi tôi không dùng tới". Hai câu hỏi khác
                nhau về một service, và ai bật cả hai phải nhìn thấy cả hai cùng lúc. */}
            <AutostartPanel service={selected} />
            <IdlePanel service={selected} />
            <LimitsPanel service={selected} />
          </>
        )}
      </div>
      {creating && <ServiceForm onCancel={() => setCreating(false)} onCreated={created} />}

      {deleteTarget !== null && (
        <ConfirmDialog
          title={t("mixengine.servicesDetail.deleteTitle", { service: deleteTarget })}
          message={forceHint ?? t("mixengine.servicesDetail.deleteMessage")}
          confirmLabel={
            forceHint !== null ? t("mixengine.servicesDetail.deleteForceConfirm") : undefined
          }
          danger
          onCancel={() => {
            setDeleteTarget(null);
            setForceHint(null);
          }}
          onConfirm={() => void deleteService(deleteTarget, forceHint !== null)}
        />
      )}
    </div>
  );
}

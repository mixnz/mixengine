import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ServiceCreation } from "@mixengine/api";
import { afterRefusal } from "../../forceStep";
import ServiceForm from "../../components/ServiceForm";
import AutostartPanel from "./AutostartPanel";
import DatabasePanel from "./DatabasePanel";
import IdlePanel from "./IdlePanel";
import LimitsPanel from "./LimitsPanel";
import styles from "./ServicesDetail.module.css";

export default function ServicesDetail({
  active,
  isModuleVisible,
}: {
  active: boolean;
  /** Straight through to `DatabasePanel`, which is what asks — see `ModuleTabProps`. */
  isModuleVisible: (moduleId: string) => boolean;
}) {
  const [ids, setIds] = useState<string[]>([]);
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
      setIds(list.services.map((s) => s.id));
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

  return (
    <div className={styles.screen}>
      {error !== "" && (
        <div className={styles.error}>
          <ErrorBanner message={error} onDismiss={() => setError("")} />
        </div>
      )}
      <div className={styles.panes}>
        <div className={styles.list}>
          <div className={styles.listActions}>
            <Button onClick={() => setCreating(true)}>
              {t("mixengine.serviceForm.newService")}
            </Button>
          </div>
          {ids.map((id) => (
            <button
              key={id}
              className={id === selected ? styles.activeRow : styles.row}
              onClick={() => setSelected(id)}
            >
              {id}
            </button>
          ))}
          {ids.length === 0 && (
            <p className={styles.listEmpty}>{t("mixengine.servicesDetail.pickService")}</p>
          )}
        </div>
        <div className={styles.detail}>
          {selected === null ? (
            <p className={styles.empty}>{t("mixengine.servicesDetail.pickService")}</p>
          ) : (
            <>
              <div className={styles.header}>
                <h3 className={styles.headerTitle}>{selected}</h3>
                <Button onClick={() => setDeleteTarget(selected)}>
                  {t("mixengine.servicesDetail.delete")}
                </Button>
              </div>
              {moved !== null && moved.service.id === selected && (
                <p className={styles.notice} role="status">
                  {movedNotice(moved)}
                </p>
              )}
              <LimitsPanel service={selected} />
              {/* Side by side and in this order: autostart says "what is running when I sit
                  down", idle says "what stays running when I am not using it". Two different
                  questions about one service, and somebody turning both on has to see both at
                  once. */}
              <AutostartPanel service={selected} />
              <IdlePanel service={selected} />
              <DatabasePanel service={selected} isModuleVisible={isModuleVisible} />
            </>
          )}
        </div>
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

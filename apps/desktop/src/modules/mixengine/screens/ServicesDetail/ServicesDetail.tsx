import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ServiceCreation } from "../../api/types/ServiceCreation";
import ServiceForm from "../../components/ServiceForm";
import DatabasePanel from "./DatabasePanel";
import IdlePanel from "./IdlePanel";
import LimitsPanel from "./LimitsPanel";
import styles from "./ServicesDetail.module.css";

export default function ServicesDetail({ active }: { active: boolean }) {
  const [ids, setIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Service vừa tạo không được cổng recipe muốn. Xem `PortMoved`: chỉ đúng ở khoảnh khắc này. */
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

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — cài/gỡ một runtime (một bản PHP chẳng
  // hạn) không sinh sự kiện gì cho màn này biết, và màn giữ mount qua lần đổi màn nên không còn
  // được "remount = đọc lại mới" miễn phí như trước; quay lại tab là đường dự phòng, xem
  // `Dashboard.tsx`.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  /* Chọn luôn service vừa tạo: người vừa dựng nó là người sắp đặt limits/idle cho nó. */
  function created(creation: ServiceCreation) {
    setCreating(false);
    setSelected(creation.service.id);
    setMoved(creation.moved_from == null ? null : creation);
    void reload();
  }

  /** Câu "nó không nằm ở cổng bạn tưởng", theo đúng ba trường hợp `PortMoved` phân biệt được. */
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
      // Cùng luật `runtime.uninstall` đã theo ở Languages.tsx: lần đầu chưa gửi `force`, refuse
      // nêu tên site nào đang khai — hỏi lại đúng câu daemon viết, không tự bịa.
      if (!force) {
        setForceHint(errorMessage(t, e));
      } else {
        setError(errorMessage(t, e));
      }
    }
  }

  return (
    <div className={styles.screen}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
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
            <IdlePanel service={selected} />
            <DatabasePanel service={selected} />
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

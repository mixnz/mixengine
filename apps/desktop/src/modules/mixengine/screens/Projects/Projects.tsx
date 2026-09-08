import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ProjectDetail } from "../../api/types/ProjectDetail";
import type { ProjectSummary } from "../../api/types/ProjectSummary";
import { formatPins } from "../../projectPins";
import ProjectForm from "./ProjectForm";
import styles from "./Projects.module.css";

interface Props {
  active: boolean;
  /** Chuyển sang màn Sites, lọc sẵn theo project này — xem `sitesNavigation.ts`. */
  onOpenSites: (project: string) => void;
}

/** Mọi project đã đăng ký trong home — tạo, sửa (tên/root/pin/keep_warm), xoá. */
export default function Projects({ active, onOpenSites }: Props) {
  const [rows, setRows] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectDetail | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const list = await api.projects();
      setRows(list.projects);
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  // Đọc lại lúc mount và mỗi lần vừa quay lại màn này — cùng lý do `Dashboard.tsx`.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  async function showDetail(name: string) {
    try {
      setDetail(await api.projectShow(name));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  async function edit(name: string) {
    try {
      setEditing(await api.projectShow(name));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  async function confirmDelete(name: string) {
    try {
      await api.projectDelete(name);
      setDeleting(null);
      void reload();
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  return (
    <div className={styles.projects}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className={styles.toolbar}>
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t("mixengine.projects.newProject")}
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("mixengine.projects.columnName")}</th>
              <th>{t("mixengine.projects.columnRoot")}</th>
              <th>{t("mixengine.projects.columnManifest")}</th>
              <th>{t("mixengine.projects.columnKeepWarm")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>
                  <button className={styles.nameButton} onClick={() => void showDetail(row.name)}>
                    {row.name}
                  </button>
                </td>
                <td>{row.root}</td>
                <td>{row.manifest ? "✓" : "—"}</td>
                <td>{row.keep_warm ? "✓" : "—"}</td>
                <td className={styles.rowActions}>
                  <Button onClick={() => onOpenSites(row.name)}>
                    {t("mixengine.projects.openSites")}
                  </Button>
                  <Button onClick={() => void edit(row.name)}>{t("mixengine.projects.edit")}</Button>
                  <Button onClick={() => setDeleting(row.name)}>
                    {t("mixengine.projects.delete")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className={styles.empty}>{t("mixengine.projects.empty")}</p>}

      {detail && (
        <div className={styles.detailPanel}>
          <h4>{t("mixengine.projects.detail.pinsTitle")}</h4>
          <ul>
            {formatPins(detail.pins).map((pin) => (
              <li key={pin.kind}>
                <strong>{pin.kind}</strong> {pin.constraint} —{" "}
                {pin.sourceLabel === "manifest"
                  ? t("mixengine.projects.detail.sourceManifest", { path: pin.sourcePath ?? "" })
                  : t("mixengine.projects.detail.sourceRow")}
                {pin.resolvedVersion
                  ? ` → ${pin.resolvedVersion}`
                  : pin.hint
                    ? ` — ${t("mixengine.projects.detail.unresolved", { hint: pin.hint })}`
                    : ""}
              </li>
            ))}
          </ul>
          <Button onClick={() => setDetail(null)}>{t("common.close")}</Button>
        </div>
      )}

      {creating && (
        <ProjectForm
          onCancel={() => setCreating(false)}
          onSaved={(warning) => {
            setCreating(false);
            if (warning) setError(warning);
            void reload();
          }}
        />
      )}

      {editing && (
        <ProjectForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t("mixengine.projects.deleteTitle")}
          message={t("mixengine.projects.deleteMessage")}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </div>
  );
}

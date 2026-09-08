import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import styles from "./CaptureDialog.module.css";

interface Props {
  onCancel: () => void;
  onCaptured: () => void;
}

/** Capture một project đang có thành một blueprint mới. Không có `blueprint.delete` — overwrite là
 *  cách duy nhất sửa một slug đã lỡ đặt sai tên. */
export default function CaptureDialog({ onCancel, onCaptured }: Props) {
  const { t } = useTranslation();
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .projects()
      .then((list) => {
        setProjectNames(list.projects.map((p) => p.name));
        if (list.projects.length > 0) setProject(list.projects[0].name);
      })
      .catch((e: unknown) => setError(errorMessage(t, e)));
  }, [t]);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await api.blueprintCapture({
        project: { name: project },
        name,
        description: description.trim() === "" ? undefined : description,
        overwrite,
      });
      onCaptured();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={t("mixengine.blueprints.capture.title")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{t("mixengine.blueprints.capture.title")}</h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("mixengine.blueprints.capture.project")}
              <Select
                value={project}
                onChange={setProject}
                disabled={saving || projectNames.length === 0}
                options={projectNames.map((n) => ({ value: n, label: n }))}
              />
            </label>

            <label className={styles.field}>
              {t("mixengine.blueprints.capture.name")}
              <Input value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
            </label>

            <label className={styles.field}>
              {t("mixengine.blueprints.capture.description")}
              <Input
                value={description}
                disabled={saving}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={overwrite}
                disabled={saving}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              {t("mixengine.blueprints.capture.overwrite")}
            </label>
            {overwrite && (
              <p className={styles.hint}>{t("mixengine.blueprints.capture.overwriteHint")}</p>
            )}
          </div>

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              size="large"
              variant="primary"
              onClick={() => void submit()}
              disabled={saving || project === "" || name.trim() === ""}
            >
              {saving ? t("mixengine.blueprints.capture.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

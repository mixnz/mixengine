import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import styles from "./ImportDialog.module.css";

interface Props {
  onCancel: () => void;
  onImported: () => void;
}

/** Nhập một blueprint từ file `.toml`. Không bao giờ thất bại vì chữ ký — kết quả chỉ đổi
 *  `trusted`/`signature` trên `BlueprintSummary` trả về, danh sách tự hiện điều đó. */
export default function ImportDialog({ onCancel, onImported }: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function browse() {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Blueprint", extensions: ["toml"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await api.blueprintImport({
        path,
        name: name.trim() === "" ? undefined : name,
        overwrite,
      });
      onImported();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={t("mixengine.blueprints.import.title")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{t("mixengine.blueprints.import.title")}</h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("mixengine.blueprints.import.path")}
              <div className={styles.pathRow}>
                <Input value={path} disabled={saving} onChange={(e) => setPath(e.target.value)} />
                <Button onClick={() => void browse()} disabled={saving}>
                  {t("common.browse")}
                </Button>
              </div>
              <p className={styles.hint}>{t("mixengine.blueprints.import.signatureHint")}</p>
            </label>

            <label className={styles.field}>
              {t("mixengine.blueprints.import.name")}
              <Input
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("mixengine.blueprints.import.namePlaceholder")}
              />
            </label>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={overwrite}
                disabled={saving}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              {t("mixengine.blueprints.import.overwrite")}
            </label>
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
              disabled={saving || path.trim() === ""}
            >
              {saving ? t("mixengine.blueprints.import.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

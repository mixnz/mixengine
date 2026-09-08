import { useState } from "react";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { SiteSharing } from "../../api/types/SiteSharing";
import styles from "./ShareDialog.module.css";

interface Props {
  domain: string;
  onCancel: () => void;
  onShared: (sharing: SiteSharing) => void;
}

/**
 * Chia sẻ một site ra LAN.
 *
 * **Không tự chọn interface.** Máy chỉ có một candidate thì bỏ trống là đủ. Máy có nhiều hơn một,
 * `site.share` từ chối và nêu tên trong `hint` — một câu, không phải một danh sách có cấu trúc — nên
 * ô interface luôn là một text field gõ tay, không phải dropdown tự điền. Đọc `hint`, gõ lại, thử
 * lại: nghiệp vụ chọn đúng interface nào ở lại phía daemon.
 */
export default function ShareDialog({ domain, onCancel, onShared }: Props) {
  const { t } = useTranslation();
  const [iface, setIface] = useState("");
  const [minutes, setMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const forSeconds = minutes.trim() === "" ? null : Number(minutes) * 60;
      const sharing = await api.siteShare({
        site: { domain },
        interface: iface.trim() === "" ? null : iface.trim(),
        for_seconds: forSeconds,
      });
      onShared(sharing);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={t("mixengine.sites.share.title")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{t("mixengine.sites.share.title")}</h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("mixengine.sites.share.interfaceLabel")}
              <Input
                value={iface}
                disabled={saving}
                onChange={(e) => setIface(e.target.value)}
                placeholder={t("mixengine.sites.share.interfaceHint")}
              />
            </label>

            <label className={styles.field}>
              {t("mixengine.sites.share.durationLabel")}
              <Input
                type="number"
                min={1}
                value={minutes}
                disabled={saving}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder={t("mixengine.sites.share.noExpiry")}
              />
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
            <Button size="large" variant="primary" onClick={() => void submit()} disabled={saving}>
              {saving ? t("mixengine.sites.form.saving") : t("mixengine.sites.share.title")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

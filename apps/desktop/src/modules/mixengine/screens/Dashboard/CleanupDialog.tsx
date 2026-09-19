import { useState } from "react";

import Modal, { ModalBody, ModalErrors } from "../../../../components/Modal";
import Checkbox from "../../../../components/Checkbox";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { DiskUsage } from "@mixengine/api";
import { cleanupFlagFor, isCleanupReclaimable } from "../../diskUsageState";
import styles from "./CleanupDialog.module.css";

interface Props {
  disk: DiskUsage;
  onCancel: () => void;
  onStarted: () => void;
}

/**
 * Dọn `logs`/`cache` qua `daemon.cleanup`.
 *
 * **Chỉ hai checkbox, luôn đúng hai** — `Reclaim::ByCleanup` chỉ bao giờ gắn với `logs`/`cache`
 * (đúng lời `Cleaned` doc-comment), nên danh sách lọc từ `disk.categories` chứ không hard-code, để
 * một máy nào đó daemon nói khác đi vẫn vẽ đúng thay vì vẽ một checkbox chết. Bỏ tick nghĩa là dọn
 * (mặc định) — `CleanupQuery.keep_logs`/`keep_cache` mặc định `false`.
 */
export default function CleanupDialog({ disk, onCancel, onStarted }: Props) {
  const { t } = useTranslation();
  const reclaimable = disk.categories.filter(isCleanupReclaimable);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await api.cleanup({
        keep_logs: keep.logs ?? false,
        keep_cache: keep.cache ?? false,
      });
      onStarted();
    } catch (e) {
      setError(errorMessage(t, e));
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={t("mixengine.dashboard.diskUsage.cleanup")}
      onClose={onCancel}
      locked={submitting}
      size="small"
      actions={[
        { kind: "cancel", label: t("common.cancel"), disabled: submitting },
        {
          kind: "confirm",
          label: t("mixengine.dashboard.diskUsage.cleanup"),
          onClick: () => void submit(),
          disabled: submitting,
        },
      ]}
    >
      {() => (
        <>
          <ModalBody>
            <div className={styles.list}>
              {reclaimable.map((category) => {
                const flag = cleanupFlagFor(category.id);
                if (flag === null || category.reclaim.reclaim !== "by_cleanup") return null;
                return (
                  <Checkbox
                    key={category.id}
                    className={styles.item}
                    label={t("mixengine.dashboard.diskUsage.cleanupKeep", {
                      category: t(`mixengine.dashboard.diskUsage.category.${category.id}`),
                    })}
                    checked={keep[category.id] ?? false}
                    disabled={submitting}
                    onChange={(e) =>
                      setKeep((current) => ({ ...current, [category.id]: e.target.checked }))
                    }
                  />
                );
              })}
            </div>
          </ModalBody>
          <ModalErrors messages={[error]} />
        </>
      )}
    </Modal>
  );
}

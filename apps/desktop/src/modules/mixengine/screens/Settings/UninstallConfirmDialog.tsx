import { useState } from "react";

import Modal, { ModalBody } from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { IS_MAC, IS_WINDOWS } from "../../../../core/platform";
import { useTranslation } from "../../../../i18n";
import styles from "./UninstallConfirmDialog.module.css";

/**
 * Chặn giữa nút "Gỡ MixEngine" và `daemon.uninstall(..., grant: true)` — T64's rule đã áp cho
 * `doctor_repair`/`ElevationDialog`, đưa sang đây bằng UI thay vì hàng đợi `elevation.status`.
 *
 * **Không vẽ lại `plan.items`.** Không giống `ElevationDialog`, dialog này không đọc từ một hàng
 * đợi live — `daemon.uninstall` gộp thẳng enqueue-và-cấp-quyền vào một job, không có danh sách
 * `PendingOp` nào tách riêng để hiện (xem doc-comment `UninstallReport`). Danh sách residue đã hiện
 * sẵn phía sau dialog này rồi; việc còn lại của dialog chỉ là chặn cú click cuối trước khi hệ điều
 * hành tự hỏi mật khẩu, không phải xem lại nó đổi gì.
 */
export default function UninstallConfirmDialog({
  onConfirm,
  onError,
  onClose,
}: {
  onConfirm: () => Promise<void>;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  // mixengine-elevate lives outside MIXENGINE_HOME only on macOS and Linux; on Windows the
  // uninstall has no such root-level helper to call out. Named for the OS this app is on — the
  // dialog speaks about this machine, not about every OS MixEngine supports.
  const elevateOs = IS_WINDOWS ? null : IS_MAC ? "macOS" : "Linux";

  async function allow() {
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("mixengine.settings.uninstall.confirmTitle")}
      onClose={onClose}
      locked={busy}
      size="small"
      actions={[
        { kind: "cancel", label: t("common.close"), disabled: busy },
        {
          kind: "danger",
          label: t("mixengine.settings.uninstall.confirmAllow"),
          onClick: () => void allow(),
          disabled: busy,
        },
      ]}
    >
      {() => (
        <>
          <ModalBody>
            <p className={styles.lead}>
              {t("mixengine.settings.uninstall.confirmLead")}
              {elevateOs !== null &&
                ` ${t("mixengine.settings.uninstall.confirmLeadElevate", { os: elevateOs })}`}
            </p>
          </ModalBody>
        </>
      )}
    </Modal>
  );
}

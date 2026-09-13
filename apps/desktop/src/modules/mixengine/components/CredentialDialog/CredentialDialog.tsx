import { useState } from "react";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import { copyText } from "../../../../core/clipboard";
import { useTranslation } from "../../../../i18n";
import type { DatabaseCredentials } from "@mixengine/api";
import styles from "./CredentialDialog.module.css";

/**
 * Mật khẩu MixEngine đang giữ cho một account, đủ để dán vào `.env` của một project.
 *
 * **Ẩn cho tới khi được hỏi.** Cửa sổ này mở ra từ một menu, nên nó có thể mở ra trước mặt người
 * khác đang nhìn màn hình; một mật khẩu hiện sẵn không cho ai cơ hội quyết định điều đó. Nút Sao
 * chép không cần nhìn thấy nó, nên đó là đường mặc định và nó đứng trước.
 *
 * Địa chỉ trong credential store đi kèm vì nó trả lời câu hỏi khác: **cái này sống ở đâu** khi ai
 * đó muốn đổi nó bằng công cụ của hệ điều hành. `SecretAddress` mang cả hai nửa (T84), nên chỗ này
 * vẽ được mà không cần biết namespace của MixEngine.
 */
export default function CredentialDialog({
  credentials,
  onClose,
}: {
  credentials: DatabaseCredentials;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  const title = t("mixengine.credentials.title", { service: credentials.service });

  return (
    <Modal
      label={title}
      onClose={onClose}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{title}</h3>

          <p className={styles.line}>
            {t("mixengine.credentials.account", { user: credentials.user })}
          </p>

          <label className={styles.field}>
            {t("mixengine.credentials.password")}
            {/* `readOnly` chứ không `disabled`: một ô xám không chọn được chữ trong nó, mà chọn tay
                là đường dự phòng khi webview từ chối clipboard (xem `core/clipboard.ts`). */}
            <Input
              value={credentials.password}
              type={shown ? "text" : "password"}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>

          <p className={styles.hint}>
            {t("mixengine.credentials.storedAt", { key: credentials.secret.key })}
          </p>

          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                void copyText(credentials.password);
                setCopied(true);
              }}
            >
              {t("mixengine.credentials.copy")}
            </Button>
            <Button onClick={() => setShown((was) => !was)}>
              {t(shown ? "mixengine.credentials.hide" : "mixengine.credentials.show")}
            </Button>
            <Button onClick={() => close(onClose)}>{t("mixengine.credentials.close")}</Button>
          </div>

          {copied && <p className={styles.copied}>{t("mixengine.credentials.copied")}</p>}
        </>
      )}
    </Modal>
  );
}

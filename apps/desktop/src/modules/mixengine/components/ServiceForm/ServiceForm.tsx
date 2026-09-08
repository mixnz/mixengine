import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { PackageSummary } from "../../api/types/PackageSummary";
import type { ServiceCreation } from "../../api/types/ServiceCreation";
import { versionKey } from "../../runtimeState";
import { DEFAULT_INSTANCE, serviceIdFrom, takesInstanceName } from "./serviceId";
import styles from "./ServiceForm.module.css";

interface Props {
  onCancel: () => void;
  /** Gọi sau khi tạo xong — cha tự `reload()` và tự kể chuyện `moved_from`. */
  onCreated: (created: ServiceCreation) => void;
}

/**
 * Dựng một service instance mới từ một package đã có trên đĩa.
 *
 * **Chỉ package, không runtime.** `php-fpm@<version>` sinh ra cùng lúc với một bản cài PHP và
 * không phải thứ dựng bằng tay ở đây; danh sách này là `package.list`, đúng những gì
 * `service.create` nhận.
 *
 * **Một lựa chọn cho cả tên lẫn phiên bản.** `ServiceCreate` bắt buộc `version` và cố ý không có
 * `service.resolve` nào chọn hộ, nhưng hai `Select` rời nhau là hai giá trị có thể lệch nhau — nên
 * mỗi dòng ở đây là một hàng `package.list` có thật, không phải một cặp người dùng tự ghép.
 */
export default function ServiceForm({ onCancel, onCreated }: Props) {
  const { t } = useTranslation();

  /** `null` là chưa hỏi xong — khác hẳn `[]`, nghĩa là hỏi rồi và trên máy không có package nào. */
  const [packages, setPackages] = useState<PackageSummary[] | null>(null);
  const [picked, setPicked] = useState("");
  const [instance, setInstance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.packagesInstalled().then(
      (list) => setPackages(list.packages),
      (e: unknown) => {
        setPackages([]);
        setError(errorMessage(t, e));
      },
    );
  }, [t]);

  const chosen = (packages ?? []).find((row) => versionKey(row.package, row.version) === picked);
  const nothingInstalled = packages !== null && packages.length === 0;
  /* Front end thì không có ô nào để gõ, nên `instance` còn sót lại từ một lựa chọn trước cũng
     không được đi theo vào id. */
  const named = chosen !== undefined && takesInstanceName(chosen.package);
  const id = chosen === undefined ? "" : serviceIdFrom(chosen.package, named ? instance : "");
  const incomplete = chosen === undefined || (named && instance.trim() === "");

  /** Đổi package là đổi luôn câu hỏi "có tên instance không", nên ô đó được đặt lại theo package. */
  function pick(next: string) {
    setPicked(next);
    const row = (packages ?? []).find((p) => versionKey(p.package, p.version) === next);
    setInstance(row !== undefined && takesInstanceName(row.package) ? DEFAULT_INSTANCE : "");
  }

  async function submit() {
    if (chosen === undefined) return;
    setSaving(true);
    setError("");
    try {
      onCreated(await api.serviceCreate({ id, version: chosen.version }));
    } catch (e) {
      // Ở lại trong modal với nguyên lựa chọn vừa rồi: câu daemon từ chối ("một web server khác
      // đang giữ cổng 80") thường được sửa bằng cách đổi một field, không bằng cách gõ lại cả form.
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={t("mixengine.serviceForm.title")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{t("mixengine.serviceForm.title")}</h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("mixengine.serviceForm.package")}
              {/* `searchable`: danh sách dài theo số package đã cài, và mỗi phiên bản là một dòng
                  riêng — một máy giữ hai bản MariaDB cạnh Redis, Postgres và hai web server thì
                  cuộn tìm lâu hơn gõ. `Select` khớp trên nhãn, và nhãn ở đây là "tên phiên-bản",
                  nên gõ `maria` hay gõ `11.4` đều tới. */}
              {nothingInstalled ? (
                <p className={styles.hint}>{t("mixengine.serviceForm.noPackages")}</p>
              ) : (
                <Select
                  value={picked}
                  onChange={pick}
                  searchable
                  disabled={packages === null || saving}
                  placeholder={t("mixengine.serviceForm.packagePlaceholder")}
                  options={(packages ?? []).map((row) => ({
                    value: versionKey(row.package, row.version),
                    label: `${row.package} ${row.version}`,
                  }))}
                />
              )}
            </label>

            {named && (
              <label className={styles.field}>
                {t("mixengine.serviceForm.instance")}
                <Input
                  value={instance}
                  disabled={saving}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder={t("mixengine.serviceForm.instancePlaceholder")}
                />
              </label>
            )}

            {id !== "" && (
              <p className={styles.hint}>
                {t("mixengine.serviceForm.idPreview", { id })}
              </p>
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
              disabled={saving || incomplete}
            >
              {saving ? t("mixengine.serviceForm.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { RuntimeSummary } from "@mixengine/api";
import ExtensionsPanel from "../Runtimes/ExtensionsPanel";
import styles from "./PhpExtensions.module.css";

/**
 * Bật tắt extension của PHP — T118.
 *
 * **Không có method mới.** `runtime.list_extensions` và `runtime.set_extension` đã tồn tại từ T28,
 * và `ExtensionsPanel` đã vẽ chúng từ khi có màn Runtimes. Thứ thiếu là *đường tới đó*: nó nằm sau
 * một hàng phiên bản phải mở ra ở một màn tên là Runtimes, bốn hàng phía trên một mục sidebar tên
 * là *Extensions* mà lại nói về một chuyện hoàn toàn khác.
 *
 * **Cùng một component, vẽ ở hai nơi**, không phải hai bản chép: mở từ Runtimes vẫn được, và bản
 * thứ hai sẽ là bản lệch đúng vào ngày một trong hai được sửa.
 *
 * **Không có PHP thì một câu và một nút**, không phải một bảng rỗng: bảng rỗng bắt người ta đoán
 * xem họ thiếu bước nào.
 */
export default function PhpExtensions({ onInstallPhp }: { onInstallPhp: () => void }) {
  const [installed, setInstalled] = useState<RuntimeSummary[] | null>(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const listed = await api.runtimesInstalled("php");
      setInstalled(listed.runtimes);
      // Bản mặc định của home, vì đó là bản `php` trên terminal đang chạy; không có thì bản đầu.
      setVersion((current) => {
        if (listed.runtimes.some((runtime) => runtime.version === current)) return current;
        const preferred = listed.runtimes.find((runtime) => runtime.default) ?? listed.runtimes[0];
        return preferred?.version ?? "";
      });
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className={styles.screen}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <h3 className={styles.title}>{t("mixengine.phpExtensions.title")}</h3>
      <p className={styles.intro}>{t("mixengine.phpExtensions.intro")}</p>

      {installed !== null && installed.length === 0 ? (
        <div className={styles.empty}>
          <p>{t("mixengine.phpExtensions.noPhp")}</p>
          <Button variant="primary" onClick={onInstallPhp}>
            {t("mixengine.phpExtensions.installPhp")}
          </Button>
        </div>
      ) : (
        <>
          <label className={styles.field}>
            {t("mixengine.phpExtensions.version")}
            <Select
              className={styles.select}
              value={version}
              onChange={setVersion}
              ariaLabel={t("mixengine.phpExtensions.version")}
              options={(installed ?? []).map((runtime) => ({
                value: runtime.version,
                label: runtime.default
                  ? `${runtime.version} — ${t("mixengine.phpExtensions.isDefault")}`
                  : runtime.version,
              }))}
            />
          </label>

          {version !== "" && <ExtensionsPanel target={{ kind: "php", version }} />}
        </>
      )}
    </div>
  );
}

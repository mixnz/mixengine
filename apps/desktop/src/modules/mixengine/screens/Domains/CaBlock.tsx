import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { Browsers } from "../../api/types/Browsers";
import type { CaStatus } from "../../api/types/CaStatus";
import type { Trust } from "../../api/types/Trust";
import ElevationDialog from "../../components/ElevationDialog";
import styles from "./CaBlock.module.css";

type Translate = ReturnType<typeof useTranslation>["t"];

/** Một câu tả `trust` — bốn nhánh tường minh, không ghép chuỗi key động. */
function trustLine(trust: Trust, t: Translate): string {
  switch (trust.state) {
    case "installed":
      return t("mixengine.domains.ca.trust.installed", { store: trust.store });
    case "not_installed":
      return t("mixengine.domains.ca.trust.notInstalled", { reason: trust.because });
    case "no_store":
      return t("mixengine.domains.ca.trust.noStore", { reason: trust.because });
    case "unknown":
      return t("mixengine.domains.ca.trust.unknown", { reason: trust.because });
  }
}

/** Một câu tả `browsers` khi không nhánh nào tới được — nhánh `reached` vẽ danh sách riêng. */
function browsersLine(browsers: Exclude<Browsers, { state: "reached" }>, t: Translate): string {
  switch (browsers.state) {
    case "no_tool":
      return t("mixengine.domains.ca.browsers.noTool", { reason: browsers.because });
    case "not_searched":
      return t("mixengine.domains.ca.browsers.notSearched", { reason: browsers.because });
    case "unknown":
      return t("mixengine.domains.ca.browsers.unknown", { reason: browsers.because });
  }
}

/**
 * Trạng thái CA — T2.6.
 *
 * **Hai hàng độc lập, không một tick xanh gộp chung.** `trust` là kho hệ thống, `browsers` là NSS
 * database của Firefox/Chrome — một máy có thể giữ CA trong kho hệ thống mà không trình duyệt nào
 * biết tới, đó là một trạng thái bình thường chứ không phải mâu thuẫn.
 */
export default function CaBlock({
  revision,
  onError,
}: {
  /** Đổi là đọc lại — `Domains` tăng nó khi một job kết thúc hay khi màn được mở lại. */
  revision: number;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CaStatus | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [pending, setPending] = useState<unknown[] | null>(null);
  const [canPrompt, setCanPrompt] = useState(true);
  const [reason, setReason] = useState<string | null | undefined>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.caStatus());
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [onError, t]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  /**
   * Luồng hai lượt T64: enqueue trước với `grant: false`, xong đọc `elevation.status` — có gì chờ
   * thì hiện `ElevationDialog` cho người dùng xem trước khi bật prompt hệ điều hành; không có gì
   * (sửa NSS database không cần quyền trên máy này) thì chỉ đọc lại trạng thái.
   */
  async function repair() {
    setRepairing(true);
    try {
      await api.caRepair({ grant: false });
      const queue = await api.elevationStatus();
      if (queue.pending.length > 0) {
        setCanPrompt(queue.can_prompt);
        setReason(queue.reason);
        setPending(queue.pending);
      } else {
        await reload();
      }
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setRepairing(false);
    }
  }

  if (status === null) return null;

  return (
    <section className={styles.block}>
      <h3 className={styles.title}>{t("mixengine.domains.ca.title")}</h3>

      {status.state !== "present" && (
        <p className={styles.warning}>
          {status.state === "absent"
            ? t("mixengine.domains.ca.absent")
            : t("mixengine.domains.ca.unusable", { reason: status.because })}
        </p>
      )}

      <div className={styles.row}>
        <span className={styles.label}>{t("mixengine.domains.ca.systemStore")}</span>
        <span>{trustLine(status.trust, t)}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t("mixengine.domains.ca.browsersLabel")}</span>
        <span>
          {status.browsers.state === "reached" ? (
            <ul className={styles.databases}>
              {status.browsers.databases.map((db) => (
                <li key={db.path}>
                  {db.owner}: {db.installed ? "✓" : (db.because ?? "—")}{" "}
                  <span className={styles.path}>{db.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            browsersLine(status.browsers, t)
          )}
        </span>
        <Button onClick={() => void repair()} disabled={repairing}>
          {repairing ? t("mixengine.domains.ca.repairing") : t("mixengine.domains.ca.repair")}
        </Button>
      </div>

      {pending && (
        <ElevationDialog
          pending={pending}
          canPrompt={canPrompt}
          reason={reason}
          onClose={() => {
            setPending(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

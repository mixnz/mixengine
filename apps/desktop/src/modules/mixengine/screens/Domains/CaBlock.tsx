import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Card from "../../../../components/Card";
import StatusPill from "../../../../components/StatusPill";
import { CheckIcon, LockIcon } from "../../../../icons";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { Browsers } from "@mixengine/api";
import type { CaStatus } from "@mixengine/api";
import type { Trust } from "@mixengine/api";
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
    <Card
      title={t("mixengine.domains.ca.title")}
      count={
        <StatusPill tone={status.state === "present" ? "success" : "danger"}>
          {status.state === "present" ? t("mixengine.domains.ca.ready") : t("mixengine.domains.ca.missing")}
        </StatusPill>
      }
      actions={
        <Button
          variant="soft"
          onClick={() => void repair()}
          busy={repairing ? t("mixengine.domains.ca.repairing") : undefined}
        >
          <LockIcon size={14} />
          {t("mixengine.domains.ca.repair")}
        </Button>
      }
    >
      {status.state !== "present" && (
        <p className={styles.warning}>
          {status.state === "absent"
            ? t("mixengine.domains.ca.absent")
            : t("mixengine.domains.ca.unusable", { reason: status.because })}
        </p>
      )}

      <dl className={styles.facts}>
        <dt>{t("mixengine.domains.ca.systemStore")}</dt>
        <dd className={status.trust.state === "installed" ? styles.good : undefined}>
          {trustLine(status.trust, t)}
        </dd>

        <dt>{t("mixengine.domains.ca.browsersLabel")}</dt>
        <dd>
          {status.browsers.state === "reached" ? (
            <ul className={styles.databases}>
              {status.browsers.databases.map((db) => (
                <li key={db.path}>
                  <span className={styles.owner}>{db.owner}</span>
                  {db.installed ? (
                    <CheckIcon size={14} className={styles.good} />
                  ) : (
                    <span className={styles.muted}>{db.because ?? "—"}</span>
                  )}
                  <span className={styles.path}>{db.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            browsersLine(status.browsers, t)
          )}
        </dd>
      </dl>

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
    </Card>
  );
}

import { useCallback, useEffect, useId, useState } from "react";

import Switch from "../../../../components/Switch";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { PathReport } from "@mixengine/api";
import { pathOutcome, type PathOutcome } from "../../pathState";
import styles from "./Settings.module.css";

/**
 * `<root>/bin` trên PATH của user này — `path.status`, `path.install`, `path.uninstall`.
 *
 * Cùng việc `mix path install` làm, để người chỉ cài app không phải mở terminal gõ lệnh mới dùng
 * được shim. Không có quyền quản trị nào ở đây: Windows ghi vào `HKCU\Environment`, Unix ghi vào
 * shell profile trong home.
 *
 * **Công tắc đọc `on_path`, không tự gấp `places`**: daemon đã quyết "đủ mọi nơi mới tính là có",
 * và một client tự gấp là chỗ hai client bất đồng về chữ "đã cài".
 */
export default function PathSection({
  active,
  onError,
}: {
  active: boolean;
  onError: (message: string) => void;
}) {
  const [report, setReport] = useState<PathReport | null>(null);
  const [outcome, setOutcome] = useState<PathOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      setReport(await api.pathStatus());
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }, [t, onError]);

  // Read again each time Settings comes back to the front: the Dashboard's card and `mix path` in a
  // terminal change the same thing, and this screen stays mounted after its first visit.
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  async function change(next: boolean) {
    setBusy(true);
    try {
      const changed = next ? await api.pathInstall() : await api.pathUninstall();
      setReport(changed);
      setOutcome(pathOutcome(changed));
    } catch (e) {
      onError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (report === null) return null;
  const stale = report.stale ?? [];

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("mixengine.settings.path.title")}</h3>
      <div className={styles.row}>
        <Switch
          checked={report.on_path}
          disabled={busy}
          aria-labelledby={labelId}
          onChange={(next) => void change(next)}
        />
        <span id={labelId}>{t("mixengine.settings.path.toggle")}</span>
      </div>
      {outcome !== null && (
        <p className={styles.muted}>
          {outcome === "changed"
            ? t("mixengine.settings.path.changed")
            : t("mixengine.settings.path.unchanged")}
        </p>
      )}
      <p className={styles.muted}>
        {t("mixengine.settings.path.directory", { directory: report.directory })}
      </p>
      {report.places.length > 0 && (
        <p className={styles.muted}>
          {t("mixengine.settings.path.places", {
            places: report.places.map((place) => place.name).join(", "),
          })}
        </p>
      )}
      {stale.length > 0 && (
        <p className={styles.warn}>{t("mixengine.settings.path.stale", { names: stale.join(", ") })}</p>
      )}
    </section>
  );
}

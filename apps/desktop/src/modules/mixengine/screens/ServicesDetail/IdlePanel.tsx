import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import styles from "./IdlePanel.module.css";

type Choice = "recipe" | "never" | "minutes";

/** Ba trạng thái, không hai: vắng mặt (theo recipe), 0 (tắt hẳn), n (n phút). Không một checkbox. */
export default function IdlePanel({ service }: { service: string }) {
  const [choice, setChoice] = useState<Choice>("recipe");
  const [minutes, setMinutes] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const current = (await api.serviceIdle(service)) as { minutes?: number | null };
      if (current.minutes === null || current.minutes === undefined) setChoice("recipe");
      else if (current.minutes === 0) setChoice("never");
      else {
        setChoice("minutes");
        setMinutes(String(current.minutes));
      }
      setError("");
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [service, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const value = choice === "recipe" ? undefined : choice === "never" ? 0 : Number(minutes);
      await api.serviceSetIdle({ service, minutes: value });
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <h4>{t("mixengine.servicesDetail.idle.title")}</h4>

      <div className={styles.choices}>
        <label className={styles.choice}>
          <input
            type="radio"
            checked={choice === "recipe"}
            disabled={saving}
            onChange={() => setChoice("recipe")}
          />
          {t("mixengine.servicesDetail.idle.useRecipe")}
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            checked={choice === "never"}
            disabled={saving}
            onChange={() => setChoice("never")}
          />
          {t("mixengine.servicesDetail.idle.never")}
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            checked={choice === "minutes"}
            disabled={saving}
            onChange={() => setChoice("minutes")}
          />
          {t("mixengine.servicesDetail.idle.afterMinutes")}
          <input
            type="number"
            className={styles.minutes}
            value={minutes}
            disabled={saving || choice !== "minutes"}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
      </div>

      <Button variant="primary" onClick={() => void save()} disabled={saving}>
        {t("mixengine.servicesDetail.idle.save")}
      </Button>
    </div>
  );
}

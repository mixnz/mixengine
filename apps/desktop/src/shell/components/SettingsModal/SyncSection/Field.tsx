import type { ReactNode } from "react";
import settings from "../SettingsModal.module.css";
import styles from "./SyncSection.module.css";

/** A control with its label above it; the `<label>` wraps it, so the caption focuses the field. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={settings.sectionLabel}>{label}</span>
      {children}
      {hint && <span className={settings.hint}>{hint}</span>}
    </label>
  );
}

export default Field;

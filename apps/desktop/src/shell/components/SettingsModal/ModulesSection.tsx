import { useState } from "react";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type { TranslationKey } from "../../../i18n";
import { useTranslation } from "../../../i18n";
import { MODULES, MODULE_PRESETS, PRESET_IDS, type PresetId } from "../../registry";
import { presetOf } from "../../profiles";
import styles from "./SettingsModal.module.css";

export interface ModuleSettings {
  /** The ids currently on. */
  enabled: string[];
  /** Set them. The workspace persists this and closes what it no longer draws. */
  onChange: (enabled: string[]) => void;
  /** Which modules have at least one tab open, so a change can say what it will close. */
  openIds: string[];
}

/** `everything` -> `profiles.presetEverything`. */
function presetLabelKey(preset: PresetId): TranslationKey {
  return `profiles.preset${preset.charAt(0).toUpperCase()}${preset.slice(1)}` as TranslationKey;
}

/**
 * Which of the app's parts this window draws.
 *
 * First in the pane column, above Appearance, because it is the setting that decides which of the
 * panes below it exist — a reader who watches panes appear and disappear should find the control
 * above them rather than under them.
 *
 * The three presets are a shortcut to a set, not a mode: the checkboxes underneath are the setting,
 * and a person who wants MixEngine and the terminal and nothing else can have exactly that. Turning
 * a module off is the only change that asks first, and only when it would close something.
 */
function ModulesSection({ enabled, onChange, openIds }: ModuleSettings) {
  const { t } = useTranslation();
  /** A change waiting on the question below, or `null`. */
  const [pending, setPending] = useState<string[] | null>(null);

  const preset = presetOf(enabled);

  /** The modules `next` turns off that have a tab open. */
  function losing(next: string[]): string[] {
    return enabled.filter((id) => !next.includes(id) && openIds.includes(id));
  }

  /* The confirmation gates the *setting*, here, and not the closing — this is the last moment at
     which the answer can still be no. The closing itself is one effect in the workspace, so every
     other way the list changes goes through the same code. */
  function propose(next: string[]) {
    if (losing(next).length === 0) onChange(next);
    else setPending(next);
  }

  function toggle(id: string, on: boolean) {
    propose(on ? [...enabled, id] : enabled.filter((other) => other !== id));
  }

  const pendingNames = pending
    ? losing(pending)
        .map((id) => {
          const module = MODULES.find((m) => m.id === id);
          return module ? t(module.labelKey) : id;
        })
        .join(", ")
    : "";

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("profiles.presets")}</span>
        <div className={styles.themeOptions}>
          {PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={
                id === preset
                  ? `${styles.themeOption} ${styles.themeOptionActive}`
                  : styles.themeOption
              }
              aria-pressed={id === preset}
              onClick={() => propose(MODULE_PRESETS[id])}
            >
              {t(presetLabelKey(id))}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("profiles.shown")}</span>
        {MODULES.map((module) => {
          const on = enabled.includes(module.id);
          /* The last one on cannot be turned off: a window with no modules in it is not a window.
             The other two guards are in `shell/profiles.ts`, where a stored value that would leave
             nothing to draw is read as no value at all. */
          const last = on && enabled.length === 1;
          return (
            <label
              key={module.id}
              className={styles.moduleRow}
              title={last ? t("profiles.lastOne") : undefined}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={last}
                onChange={(e) => toggle(module.id, e.target.checked)}
              />
              <module.Icon size={15} />
              <span>{t(module.labelKey)}</span>
            </label>
          );
        })}
        <p className={styles.hint}>{t("profiles.changeLater")}</p>
      </div>

      {pending && (
        <ConfirmDialog
          title={t("profiles.confirmTitle")}
          message={t("profiles.confirmMessage", { modules: pendingNames })}
          confirmLabel={t("profiles.confirmAction")}
          danger
          onConfirm={() => {
            onChange(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

export default ModulesSection;

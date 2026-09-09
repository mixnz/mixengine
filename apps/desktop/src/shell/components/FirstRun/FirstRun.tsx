import type { TranslationKey } from "../../../i18n";
import { useTranslation } from "../../../i18n";
import { PRESET_IDS, type PresetId } from "../../registry";
import styles from "./FirstRun.module.css";

interface FirstRunProps {
  onChoose: (preset: PresetId) => void;
}

/** `everything` -> `profiles.presetEverything`, and the sentence under it. */
function presetKeys(preset: PresetId): { label: TranslationKey; about: TranslationKey } {
  const name = `${preset.charAt(0).toUpperCase()}${preset.slice(1)}`;
  return {
    label: `profiles.preset${name}` as TranslationKey,
    about: `profiles.preset${name}About` as TranslationKey,
  };
}

/**
 * One question, three answers, one click — the only screen a fresh MixLab shows before the window.
 *
 * The whole window rather than a dialog: a dialog needs a workspace behind it, and the workspace
 * cannot be built until this is answered, which is the reason `App` is a gate at all. There is no
 * dismiss control, and there is nothing to lose by choosing: every answer is reversible from
 * Settings, and the line under the buttons says so.
 */
function FirstRun({ onChoose }: FirstRunProps) {
  const { t } = useTranslation();

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.question}>{t("profiles.question")}</h1>
        <div className={styles.choices}>
          {PRESET_IDS.map((preset, i) => {
            const keys = presetKeys(preset);
            return (
              <button
                key={preset}
                type="button"
                className={styles.choice}
                autoFocus={i === 0}
                onClick={() => onChoose(preset)}
              >
                <span className={styles.choiceName}>{t(keys.label)}</span>
                <span className={styles.choiceAbout}>{t(keys.about)}</span>
              </button>
            );
          })}
        </div>
        <p className={styles.hint}>{t("profiles.changeLater")}</p>
      </div>
    </main>
  );
}

export default FirstRun;

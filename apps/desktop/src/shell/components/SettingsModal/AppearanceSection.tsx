import type { CSSProperties } from "react";
import type { AccentColor, ThemeMode } from "../../theme";
import { ACCENT_COLORS } from "../../theme";
import type { Language, TranslationKey } from "../../../i18n";
import { useTranslation } from "../../../i18n";
import styles from "./SettingsModal.module.css";

interface Props {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  accent: AccentColor;
  onAccentChange: (accent: AccentColor) => void;
  glass: boolean;
  onGlassChange: (glass: boolean) => void;
}

/** `blue` -> `settings.accentBlue`, the label beside each swatch. */
function accentLabelKey(accent: AccentColor): TranslationKey {
  return `settings.accent${accent.charAt(0).toUpperCase()}${accent.slice(1)}` as TranslationKey;
}

/**
 * Everything about how the app looks and reads: light or dark, which accent, which language.
 *
 * The three sit together because they are the settings a user changes on a whim and sees the
 * result of immediately — unlike the tools and the updater, which are errands.
 */
function AppearanceSection({ theme, onThemeChange, accent, onAccentChange, glass, onGlassChange }: Props) {
  const { t, lang, setLang } = useTranslation();

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];

  const glassOptions: { value: boolean; label: string }[] = [
    { value: false, label: t("settings.glassOff") },
    { value: true, label: t("settings.glassOn") },
  ];

  const languageOptions: { value: Language; label: string }[] = [
    { value: "en", label: t("settings.languageEnglish") },
    { value: "vi", label: t("settings.languageVietnamese") },
  ];

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("settings.theme")}</span>
        <div className={styles.themeOptions}>
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={opt.value === theme ? `${styles.themeOption} ${styles.themeOptionActive}` : styles.themeOption}
              onClick={() => onThemeChange(opt.value)}
              aria-pressed={opt.value === theme}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("settings.accent")}</span>
        <div className={styles.accentOptions}>
          {ACCENT_COLORS.map((opt) => {
            const label = t(accentLabelKey(opt));
            return (
              <button
                key={opt}
                type="button"
                className={opt === accent ? `${styles.accentOption} ${styles.accentOptionActive}` : styles.accentOption}
                /* The palette lives in App.css; the swatch only names which of the ten it is,
                   so it picks up that colour's light and dark cast on its own. */
                style={{ "--accent-swatch": `var(--c-${opt})` } as CSSProperties}
                onClick={() => onAccentChange(opt)}
                title={label}
                aria-label={label}
                aria-pressed={opt === accent}
              />
            );
          })}
        </div>
      </div>

      {/* Off is listed first because off is the default, and because it is the plain surface the
          rest of the app is drawn on — the glass is the departure from it, not the baseline. */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("settings.glass")}</span>
        <div className={styles.themeOptions}>
          {glassOptions.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={opt.value === glass ? `${styles.themeOption} ${styles.themeOptionActive}` : styles.themeOption}
              onClick={() => onGlassChange(opt.value)}
              aria-pressed={opt.value === glass}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className={styles.hint}>{t("settings.glassHint")}</p>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>{t("settings.language")}</span>
        <div className={styles.themeOptions}>
          {languageOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={opt.value === lang ? `${styles.themeOption} ${styles.themeOptionActive}` : styles.themeOption}
              onClick={() => setLang(opt.value)}
              aria-pressed={opt.value === lang}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default AppearanceSection;

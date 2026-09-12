import { useState } from "react";
import type { ComponentType } from "react";
import type { AccentColor, ThemeMode } from "../../theme";
import type { TranslationKey } from "../../../i18n";
import type { IconProps } from "../../../icons";
import type { ShortcutGroup } from "../../../core/shortcuts";
import { CloseIcon, DownloadIcon, KeyboardIcon, ModulesIcon, PaletteIcon } from "../../../icons";
import { useTranslation } from "../../../i18n";
import { visibleModules } from "../../profiles";
import AppearanceSection from "./AppearanceSection";
import ModulesSection, { type ModuleSettings } from "./ModulesSection";
import ShortcutsSection from "./ShortcutsSection";
import UpdateSection from "./UpdateSection";
import styles from "./SettingsModal.module.css";
import Modal from "../../../components/Modal";

interface SettingsModalProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  accent: AccentColor;
  onAccentChange: (accent: AccentColor) => void;
  glass: boolean;
  onGlassChange: (glass: boolean) => void;
  /** The catalogue the dispatcher was handed — see {@link ShortcutsSection}. */
  shortcuts: ShortcutGroup[];
  /** Which modules this window draws, and how to change it. */
  modules: ModuleSettings;
  onClose: () => void;
}

/** A module's pane is identified by its module id, so this cannot be a closed union. */
type SectionId = string;

/**
 * Everything about the app rather than about a connection.
 *
 * It is a list of panes rather than one long scroll: theme, accent and language are settings, the
 * dump tools are a downloader, and the last one is about the application itself — three things that
 * happen to live behind the same door, and reading as one column made the door look busier than
 * what is behind it.
 */
function SettingsModal({
  theme,
  onThemeChange,
  accent,
  onAccentChange,
  glass,
  onGlassChange,
  shortcuts,
  modules,
  onClose,
}: SettingsModalProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("appearance");

  const visible = visibleModules(modules.enabled);

  /* The panes, in the order they are listed: the one a user changes often, then which parts of the
     app this window has at all, then whatever the visible modules contribute, then the errands.
     Appearance leads because it is the pane a user opens this dialog for most; Modules sits right
     under it because it is the setting that decides which of the panes below it exist.

     Rebuilt on every render rather than held as a module-level constant — T108 — because the module
     panes come and go with the setting the Modules pane carries.

     A module names its own pane, and every one of them names itself after the module — so the
     column reads as the app's parts, and a reader can tell before clicking which entries are the
     dialog's own and which belong to something they opened a tab of. What is *inside* a pane is
     that module's business and carries its own headings; the shell never sees them. */
  const sections: { id: SectionId; labelKey: TranslationKey; icon: ComponentType<IconProps> }[] = [
    { id: "appearance", labelKey: "settings.appearance", icon: PaletteIcon },
    { id: "modules", labelKey: "profiles.title", icon: ModulesIcon },
    { id: "shortcuts", labelKey: "shortcuts.title", icon: KeyboardIcon },
    ...visible.flatMap((m) =>
      m.settings ? [{ id: m.id, labelKey: m.settings.labelKey, icon: m.settings.Icon }] : [],
    ),
    { id: "update", labelKey: "update.title", icon: DownloadIcon },
  ];

  /* Turning a module off while its own pane is on screen would leave `section` pointing at nothing.
     Derived rather than repaired in an effect, so there is no frame in which the dialog has no pane
     at all. */
  const shown = sections.some((s) => s.id === section) ? section : "appearance";

  return (
    <Modal
      label={t("settings.title")}
      onClose={onClose}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <div className={styles.header}>
            <h3 className={styles.title}>{t("settings.title")}</h3>
            <button type="button" className={styles.close} onClick={() => close(onClose)} title={t("settings.close")}>
              <CloseIcon />
            </button>
          </div>

          <div className={styles.body}>
            <div className={styles.nav} role="tablist" aria-orientation="vertical">
              {sections.map(({ id, labelKey, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-selected={id === shown}
                  aria-controls={`settings-panel-${id}`}
                  className={id === shown ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
                  onClick={() => setSection(id)}
                >
                  <Icon size={15} />
                  <span className={styles.navLabel}>{t(labelKey)}</span>
                </button>
              ))}
            </div>

            {/* Hidden rather than unmounted: a dump tool downloading under Database carries on when the user
                goes to look at something else, and it has to still be there — with its bar where it
                left it — when they come back. */}
            <div
              className={styles.panel}
              role="tabpanel"
              id="settings-panel-appearance"
              aria-labelledby="settings-tab-appearance"
              hidden={shown !== "appearance"}
            >
              <AppearanceSection
                theme={theme}
                onThemeChange={onThemeChange}
                accent={accent}
                onAccentChange={onAccentChange}
                glass={glass}
                onGlassChange={onGlassChange}
              />
            </div>
            <div
              className={styles.panel}
              role="tabpanel"
              id="settings-panel-modules"
              aria-labelledby="settings-tab-modules"
              hidden={shown !== "modules"}
            >
              <ModulesSection {...modules} />
            </div>
            <div
              className={styles.panel}
              role="tabpanel"
              id="settings-panel-shortcuts"
              aria-labelledby="settings-tab-shortcuts"
              hidden={shown !== "shortcuts"}
            >
              <ShortcutsSection shortcuts={shortcuts} />
            </div>
            {visible.map((m) =>
              m.settings ? (
                <div
                  key={m.id}
                  className={styles.panel}
                  role="tabpanel"
                  id={`settings-panel-${m.id}`}
                  aria-labelledby={`settings-tab-${m.id}`}
                  hidden={shown !== m.id}
                >
                  <m.settings.Section />
                </div>
              ) : null,
            )}
            <div
              className={styles.panel}
              role="tabpanel"
              id="settings-panel-update"
              aria-labelledby="settings-tab-update"
              hidden={shown !== "update"}
            >
              <UpdateSection />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

export default SettingsModal;

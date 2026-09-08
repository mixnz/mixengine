import type { ShortcutDef, ShortcutGroup } from "../core/shortcuts";
import { MODULES } from "./registry";

/** How many modules get a chord of their own: `Ctrl/Cmd+1` to `Ctrl/Cmd+9`, in registry order. A
 *  tenth module would need a scheme this is not, so it simply goes without — the `[+]` menu opens
 *  it, and `Ctrl/Cmd+T` still opens the default. */
const MAX_NUMBERED_MODULES = 9;

/** The id the chord for one module's new tab is filed under. `app.newTab` opens the default one and
 *  keeps its plain id; these are named after the module so the pair reads together in a log. */
export function newModuleTabId(moduleId: string): string {
  return `app.newTab.${moduleId}`;
}

/**
 * A number key per module: `Ctrl/Cmd+1` opens a tab of the first module in the registry, `2` the
 * second.
 *
 * Derived rather than written out, and paired with the module each one opens, because `App.tsx`
 * registers its handlers from this same list. A chord in the table that no handler answers, or a
 * handler under an id the dispatcher has never heard of, are both things nothing would have said
 * out loud — so neither list is written twice.
 */
export const MODULE_TAB_SHORTCUTS: { moduleId: string; def: ShortcutDef }[] = MODULES
  .slice(0, MAX_NUMBERED_MODULES)
  .map((module, i) => ({
    moduleId: module.id,
    def: {
      id: newModuleTabId(module.id),
      chord: { key: String(i + 1) },
      labelKey: "shortcuts.newModuleTab",
      // The module's own name, so the table says "New REST tab" without this file knowing there is
      // a REST module — the registry is still the only place outside `src/modules/` that may.
      labelVars: { module: module.labelKey },
      // As `app.newTab` is, and for no better reason than that these are the same command with the
      // module chosen. If one of them stops answering from behind a dialog, they all should.
      inModal: true,
    },
  }));

/** The chords the app answers wherever you are — the tab bar's, and the reload every pane shares. */
export const SHELL_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "app",
    labelKey: "shortcuts.scope.app",
    defs: [
      /* `inModal` because that is what they do today: `App.tsx` guards neither, so a new tab opens
         and a tab closes from behind an open dialog. The registry is the first thing that made the
         question visible, and a refactor that answers it differently is a refactor nobody can
         trust. Deciding otherwise later is one flag on one line. */
      { id: "app.newTab", chord: { key: "t" }, labelKey: "shortcuts.newTab", inModal: true },
      ...MODULE_TAB_SHORTCUTS.map((entry) => entry.def),
      { id: "app.closeTab", chord: { key: "w" }, labelKey: "shortcuts.closeTab", inModal: true },
      /* `ctrl` rather than the platform's modifier, because `Cmd+Tab` never reaches a Mac app —
         see `Chord.ctrl`. Not `inModal`, unlike the three above: those carry the flag because
         `App.tsx` never guarded them and a refactor is no place to change what a key does, while
         these two are new and nothing is owed to them. Moving the tab underneath a dialog while
         the dialog stays where it is would be a screen that disagrees with itself. */
      {
        id: "app.nextTab",
        chord: { key: "tab", ctrl: true },
        labelKey: "shortcuts.nextTab",
        unhandled: "swallow",
      },
      {
        id: "app.prevTab",
        chord: { key: "tab", ctrl: true, shift: true },
        labelKey: "shortcuts.prevTab",
        unhandled: "swallow",
      },
      /* Not `inModal`: the pane behind a dialog is not the one in front, and a reload fired from
         behind a confirmation acts on the very thing being asked about. */
      { id: "pane.reload", chord: { key: "r" }, labelKey: "shortcuts.reload" },
    ],
  },
];

/**
 * Every chord in the app, the shell's and the modules'.
 *
 * Assembled here rather than inside `core/shortcuts/`: that folder is the mechanism and may not
 * import from `shell/` or `modules/` at all — see `.agent/architecture/frontend.md`. The
 * dispatcher is handed this list; it never goes looking for one.
 *
 * A module-level constant, so the dispatcher binds its listener once for the life of the app.
 */
export const ALL_SHORTCUTS: ShortcutGroup[] = [
  ...SHELL_SHORTCUTS,
  ...MODULES.flatMap((m) => m.shortcuts ?? []),
];

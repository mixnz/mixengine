import type { TranslationKey } from "../../i18n";

/**
 * A chord, without the modifier that makes it one.
 *
 * There is no `ctrl` or `meta` here on purpose. Which of the two counts is a platform question with
 * exactly one right answer — `⌘` on a Mac, `Ctrl` elsewhere, and the other one being held rules the
 * chord out — and `core/platform.ts` exists to hold that answer once. A registry that let a chord
 * name its own modifier would be the first place that rule got broken, and the remap screen after
 * it the second.
 */
export interface Chord {
  /** Lower case, compared against `e.key.toLowerCase()`. */
  key: string;
  shift?: boolean;
  alt?: boolean;
  /**
   * `Ctrl` on every platform, the Mac included — the one exception to everything said above, and
   * it is the platform itself that forces it.
   *
   * `Cmd+Tab` never reaches a Mac application: the window server takes it for the App Switcher
   * before any process sees the key. So the rule that a chord is whatever the platform writes on
   * its keyboards has no answer here — the chord the platform writes does not exist. Every browser
   * on macOS settled this the same way and cycles its tabs on `Ctrl+Tab`, which is what this flag
   * is for and the only thing it is for.
   */
  ctrl?: true;
}

export interface ShortcutDef {
  /** Never changes. This is what a handler registers under, and what a remapping would be filed
   *  against — so it outlives whatever key it happens to carry today. */
  id: string;
  chord: Chord;
  labelKey: TranslationKey;
  /** What goes in `labelKey`'s blanks, as translation keys resolved where the label is drawn. A
   *  catalogue is static data with no `t` of its own, so a chord named after something the app
   *  already has a word for — a module — says which word rather than repeating it. */
  labelVars?: Record<string, TranslationKey>;
  /** Left alone where the user is typing — see `core/textEntry.ts`. Select-all inside the filter
   *  bar is that field's own, not the grid's. */
  whenTyping?: "ignore";
  /** Still answers while a modal is up. Off by default: the keyboard belongs to whatever is on
   *  top. */
  inModal?: true;
  /** Take the key off the webview even when nothing is listening. Off by default, so an unclaimed
   *  chord goes through untouched. */
  unhandled?: "swallow";
  /**
   * Other keys that mean the same gesture. Matched by the dispatcher, never listed — the table
   * shows `chord` and only that.
   *
   * "Bigger" is one gesture to a user and three events to a browser: `Ctrl+=` on the key that also
   * carries `+`, `Ctrl+Shift+=` when the shift is actually held, and the numpad's own `+`. Giving
   * each an id of its own would put three identical rows in the shortcut table and make a pane
   * register three handlers for one action.
   */
  alias?: Chord[];
  /** Listed in the table, ignored by the dispatcher. For the keys CodeMirror binds itself. */
  owner?: "editor";
}

/** One heading in the shortcut table. Grouping in the data is what makes a scope without a label
 *  impossible to write. */
export interface ShortcutGroup {
  scope: string;
  labelKey: TranslationKey;
  defs: ShortcutDef[];
}

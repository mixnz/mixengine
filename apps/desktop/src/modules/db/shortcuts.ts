import type { ShortcutGroup } from "../../core/shortcuts";

/**
 * The chords this module's panes answer, handed to the shell through `ModuleDefinition.shortcuts`.
 *
 * Labelled out of this module's own dictionary rather than a `shortcuts.*` group of its own: the
 * shell owns that group name, and a second dictionary claiming it stops the build — see
 * `src/i18n/dicts.ts`. It reads better this way anyway, with "Select every row" sitting beside the
 * rest of the grid's words where a translator is already looking.
 */
export const DB_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "db.data",
    labelKey: "sqlTable.shortcutScope",
    defs: [
      /* `swallow` is what stops the webview painting the app's own chrome blue where no grid is
         listening — on the connection form, on a future module's tab. That is exactly what
         `App.tsx` did before, unconditionally and outside a text field; what is new is only that
         the authority for it now sits in the data beside the grid that acts on the key. If that
         placement ever gets in the way, the fix is a shell-owned def carrying nothing but
         `unhandled: "swallow"`, not a change to the mechanism. */
      {
        id: "grid.selectAll",
        chord: { key: "a" },
        labelKey: "sqlTable.shortcutSelectAll",
        whenTyping: "ignore",
        unhandled: "swallow",
      },
      /* No `whenTyping`: jumping to the filter bar is what the user wants from inside the filter
         bar too, and from a cell open for editing. That matches today — the `f` branch runs before
         the text-field check. */
      { id: "grid.focusFilter", chord: { key: "f" }, labelKey: "sqlTable.shortcutFilter" },
    ],
  },
  {
    scope: "db.query",
    labelKey: "query.shortcutScope",
    defs: [
      /* CodeMirror binds this on the editor element itself, so it answers before anything on the
         window ever sees it. It is here to be listed — a shortcut the table left out is one the
         user has no way to find. `owner` is what keeps the dispatcher's hands off it. */
      {
        id: "editor.format",
        chord: { key: "f", shift: true },
        labelKey: "query.shortcutFormat",
        owner: "editor",
      },
    ],
  },
];

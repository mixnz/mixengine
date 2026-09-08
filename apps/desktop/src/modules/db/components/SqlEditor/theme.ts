import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * How the editor is painted.
 *
 * Every colour here is a CSS custom property defined in `SqlEditor.module.css` — none is written
 * as a value. CodeMirror's own themes are static: the extension list is built once, and the app's
 * theme and accent change under it while it runs. Naming a variable is what lets one theme object
 * follow light, dark and all ten accents without being rebuilt.
 */

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontFamily: '"Fira Code", monospace',
    fontSize: "0.9em",
    color: "var(--sql-text)",
    backgroundColor: "transparent",
  },
  // The pane around the editor draws the focus ring; a second one here would sit inside it.
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.55",
    overscrollBehavior: "contain",
  },
  ".cm-content": { padding: "0.45rem 0" },
  ".cm-line": { padding: "0 0.7rem" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--sql-text)" },
  // The selection layer is what CodeMirror paints when the editor has focus, and the plain
  // `::selection` rule is what the browser paints when it does not. Both, or a selection made and
  // then clicked away from disappears.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--sql-selection)",
  },
  // Filled, not transparent: the gutter is `position: sticky` at the left edge, so every line of a
  // script too wide for the editor passes behind it. See `--sql-gutter-bg` for what the fill is
  // made of.
  ".cm-gutters": {
    background: "var(--sql-gutter-bg)",
    color: "var(--sql-gutter)",
    border: "none",
    paddingRight: "0.15rem",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 0.4rem 0 0.7rem" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--sql-gutter-active)" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 0.2rem" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--sql-bracket)",
    outline: "none",
  },
  ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--sql-bracket-bad)",
  },
  ".cm-placeholder": { color: "var(--sql-comment)" },
  ".cm-selectionMatch": { backgroundColor: "var(--sql-match)" },
  ".cm-searchMatch": { backgroundColor: "var(--sql-match)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--sql-match-selected)" },
  // The search and replace panel. It is CodeMirror's own markup, so it is dressed here rather
  // than in the stylesheet — but out of the same tokens as every other control in the app.
  ".cm-panels": {
    backgroundColor: "var(--page-bg)",
    color: "inherit",
    borderTop: "1px solid var(--border)",
  },
  ".cm-panel.cm-search": { padding: "0.4rem 0.5rem", fontFamily: "inherit", fontSize: "0.85em" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    fontFamily: "inherit",
    fontSize: "inherit",
    color: "inherit",
    backgroundColor: "var(--control-bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.15rem 0.35rem",
  },
  ".cm-panel.cm-search label": { fontSize: "0.95em" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface-bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-md)",
    color: "inherit",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: '"Fira Code", monospace',
    fontSize: "0.85em",
    maxHeight: "14rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "0.15rem 0.5rem" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "rgb(var(--accent-rgb) / 0.15)",
    color: "var(--accent-text)",
  },
  ".cm-completionIcon": { paddingRight: "0.6em", opacity: "0.6" },
  ".cm-completionDetail": { marginLeft: "0.75em", fontStyle: "normal", opacity: "0.6" },

  // The error checking. CodeMirror draws its squiggles as a repeating background image, which
  // cannot be a CSS variable and so cannot follow the theme — a wavy underline can, and is the
  // same mark the browser draws under a misspelling.
  ".cm-lintRange": {
    backgroundImage: "none",
    textDecoration: "underline wavy",
    textDecorationThickness: "1px",
    textUnderlineOffset: "0.25em",
  },
  // The image is cleared on the specific classes too, not only on `.cm-lintRange`: CodeMirror's
  // own rules set it per severity, and clearing only the shared class would leave those standing.
  ".cm-lintRange-error": { backgroundImage: "none", textDecorationColor: "var(--sql-error)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecorationColor: "var(--sql-warning)" },
  ".cm-tooltip.cm-tooltip-lint": { maxWidth: "32rem" },
  ".cm-diagnostic": { fontFamily: "inherit", fontSize: "0.85em", lineHeight: "1.45" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--sql-error)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--sql-warning)" },
  ".cm-diagnosticSource": { fontSize: "85%", opacity: "0.6" },
  ".cm-diagnosticAction": {
    marginLeft: "0.5em",
    padding: "0.1rem 0.45rem",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    backgroundColor: "var(--control-bg)",
    color: "var(--accent-text)",
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  ".cm-panel.cm-panel-lint ul [aria-selected]": {
    backgroundColor: "rgb(var(--accent-rgb) / 0.15)",
  },
  ".cm-panel.cm-panel-lint button[name=close]": { color: "inherit" },
});

/**
 * The syntax colours, mapped from the tags `@codemirror/lang-sql` emits.
 *
 * The palette is the one `JsonView` already uses for JSON, so a script and a JSON value in the
 * same window are coloured by one scheme rather than by two.
 */
export const sqlHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "var(--sql-keyword)", fontWeight: "600" },
    { tag: tags.operator, color: "var(--sql-operator)" },
    { tag: tags.typeName, color: "var(--sql-type)" },
    { tag: tags.standard(tags.name), color: "var(--sql-builtin)" },
    { tag: tags.special(tags.name), color: "var(--sql-builtin)" },
    { tag: tags.string, color: "var(--sql-string)" },
    // A backtick-quoted identifier is a name, not a string — MySQL's own quoting, and it reads
    // wrongly in the string colour.
    { tag: tags.special(tags.string), color: "var(--sql-identifier)" },
    { tag: tags.number, color: "var(--sql-number)" },
    { tag: tags.bool, color: "var(--sql-keyword)" },
    { tag: tags.null, color: "var(--sql-keyword)" },
    { tag: tags.lineComment, color: "var(--sql-comment)", fontStyle: "italic" },
    { tag: tags.blockComment, color: "var(--sql-comment)", fontStyle: "italic" },
    { tag: tags.punctuation, color: "var(--sql-punctuation)" },
    { tag: tags.paren, color: "var(--sql-punctuation)" },
    { tag: tags.brace, color: "var(--sql-punctuation)" },
    { tag: tags.squareBracket, color: "var(--sql-punctuation)" },
  ])
);

# CodeMirror 6 for the Query tab's editor

The Query tab used a `<textarea>`. Replacing it meant picking an editor to build the rest of the
[roadmap](../notes/query-editor-roadmap.md) on — completion, linting, hover docs, all of it.

## The choice

**CodeMirror 6**, as `@codemirror/{state,view,commands,language,autocomplete,search}` plus
`@codemirror/lang-sql`. Formatting is `sql-formatter`.

- `lang-sql` ships a MySQL dialect: backtick identifiers, `--`/`#`/`/*! */` comments, MySQL's
  keyword and type sets. Nothing here had to be written.
- Schema-driven completion is its API, not something layered on top: it tracks the tables a
  statement is `FROM`, their aliases, and completes columns accordingly.
- Plain ESM that tree-shakes, and a theme that is CSS — so the editor wears the app's own tokens,
  accent and Fira Code, and follows a theme switch at runtime without being rebuilt.

Monaco was the alternative: VS Code's engine, far more in the box, but ~5 MB with web workers, its
own theming model, and no MySQL language service — that part would have been ours to write anyway.

## What follows from it

- **Colours are CSS variables, never values in TypeScript.** The extension list is built once and
  lives as long as the editor; the app's theme and accent change under it. `SqlEditor.module.css`
  defines the `--sql-*` set, `theme.ts` only names them.
- **The extension list is built once.** Callbacks reach it through a ref; the schema is swapped
  through a `Compartment`. Rebuilding on every render would cost the undo history and the caret.
- **React owns the value either side of the mount, CodeMirror owns it during.** `value` is written
  in only when it differs from what is on screen — otherwise a keystroke's own round trip through
  React state drags the caret to the end of the document.

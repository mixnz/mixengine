import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, type SQLDialect, type SQLNamespace } from "@codemirror/lang-sql";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  Prec,
  RangeSetBuilder,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { sqlLint, type LintSources } from "./lint";
import { sqlLookup, type EditorLookup } from "./lookup";
import { editorTheme, sqlHighlighting } from "./theme";
import styles from "./SqlEditor.module.css";

/** Where a statement sits in the script. The editor is handed a function returning one; what
 *  counts as a statement is the caller's business, not this component's. */
export interface StatementRange {
  from: number;
  to: number;
}

/** Holds the `sql()` extension, so the schema can be swapped in when it finishes loading without
 *  the editor being rebuilt around it. */
export const schemaCompartment = new Compartment();

/** The document as one string, remembering the last one asked for.
 *
 * Everything outside CodeMirror works on a plain string — the statement splitter, the React state
 * the script lives in — and each of them would otherwise flatten the document for itself on every
 * keystroke. A `Text` is immutable, so its identity is a sound key: same object, same string. One
 * entry is enough, because within a keystroke every caller is asking about the same document. */
let lastDoc: Text | null = null;
let lastText = "";

export function docText(doc: Text): string {
  if (doc !== lastDoc) {
    lastDoc = doc;
    lastText = doc.toString();
  }
  return lastText;
}

/** The language extension for a given schema — in the engine's own dialect, with completion over
 *  the schema when there is one. `defaultSchema` is what lets both `table` and `db.table`
 *  complete. */
export function sqlLanguage(
  schema: SQLNamespace | null,
  database: string,
  dialect: SQLDialect
): Extension {
  return sql({
    dialect,
    // Written in upper case because that is how SQL is written here, and because it is what tells
    // a keyword apart from an identifier at a glance in a script that mixes the two.
    upperCaseKeywords: true,
    ...(schema ? { schema, defaultSchema: database } : {}),
  });
}

/** Something else the editor can offer alongside the schema — a saved query, by the name it was
 *  saved under. What such a thing *is* belongs to the caller; all this knows is the three strings. */
export interface EditorCompletion {
  /** What is typed to reach it. */
  label: string;
  /** The grey line beside it in the list. */
  detail?: string;
  /** What replaces the typed word when it is picked. */
  apply: string;
}

/**
 * Puts the caller's own completions in the same list the tables come from.
 *
 * Attached to the MySQL language's data rather than handed to `autocompletion()`: an editor takes
 * one autocompletion configuration, and overriding it would mean rebuilding the schema completion
 * this sits beside. Registering against the language leaves that one alone and adds to it.
 */
function extraCompletions(
  source: () => readonly EditorCompletion[],
  dialect: SQLDialect
): Extension {
  return dialect.language.data.of({
    autocomplete: (context: CompletionContext): CompletionResult | null => {
      const options = source();
      if (options.length === 0) return null;
      const word = context.matchBefore(/\w+/);
      // Nothing typed and nothing asked for: an unprompted list of saved queries in the middle of
      // a statement is noise.
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return {
        from: word.from,
        options: options.map((option) => ({
          label: option.label,
          type: "text",
          ...(option.detail ? { detail: option.detail } : {}),
          apply: option.apply,
        })),
      };
    },
  });
}

/**
 * Marks the lines of the statement the caret is in, so where the server will cut the script is
 * visible while it is being written. Nothing runs from it — `Ctrl+R` sends the selection, or the
 * lot — so this says "here is one statement", not "here is what would run".
 *
 * Recomputed on a doc change, and on a selection change only when the caret has actually left the
 * range it was in. Splitting the script is cheap on a script and not on a 10,000-line dump, and
 * moving the caret within one statement is by far the commonest thing that happens here.
 */
function activeStatement(statementRange: (doc: string, pos: number) => StatementRange | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** The range last marked, kept so an unchanged one can be recognised without splitting. */
      range: StatementRange | null = null;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        // The caret moving within the statement it was already in changes nothing — but a
        // selection being drawn does, since a selection is marked by not marking a statement.
        if (!update.docChanged && this.range && update.state.selection.main.empty) {
          const pos = update.state.selection.main.head;
          if (pos >= this.range.from && pos <= this.range.to) return;
        }
        this.decorations = this.build(update.view);
      }

      build(view: EditorView): DecorationSet {
        const { state } = view;
        const selection = state.selection.main;
        // A selection is its own answer to "what would run", and marking a statement underneath it
        // would only be a second highlight fighting the first.
        this.range = selection.empty ? statementRange(docText(state.doc), selection.head) : null;
        const builder = new RangeSetBuilder<Decoration>();
        if (this.range) {
          const first = state.doc.lineAt(this.range.from).number;
          const last = state.doc.lineAt(this.range.to).number;
          for (let line = first; line <= last; line += 1) {
            builder.add(
              state.doc.line(line).from,
              state.doc.line(line).from,
              Decoration.line({ class: styles.statementLine })
            );
          }
        }
        return builder.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

export interface EditorSetup {
  placeholder: string;
  /** What to complete against as the editor is created. It is swapped through
   *  {@link schemaCompartment} afterwards, but an editor rebuilt while a schema is already loaded
   *  has to open with it — nothing would swap it back in. */
  schema: SQLNamespace | null;
  database: string;
  /** The engine's CodeMirror dialect: what is highlighted as a keyword, and what completes. */
  dialect: SQLDialect;
  /** The statement the caret is in, for the highlight. Must be stable — it is read on every
   *  update, and the extension list is built once. */
  statementRange: (doc: string, pos: number) => StatementRange | null;
  /** `Ctrl+Shift+F`. Running the script is *not* bound here: `Ctrl+R` does that, and it is claimed
   *  once for the whole app rather than per focused widget — see `src/reload.ts`. */
  onFormat: () => void;
  /** Where the underlines come from, read fresh on every check so the schema arriving — or the
   *  connection going away — is picked up without the editor being rebuilt. Null turns checking
   *  off entirely. */
  lint: () => LintSources | null;
  /** Completions of the caller's own, read fresh each time the list is built. */
  completions: () => readonly EditorCompletion[];
  /** What a name in the script means and where it leads, for the hover tooltip and `Ctrl+Click`.
   *  Null for an editor that knows nothing about what it is written against. */
  lookup: () => EditorLookup | null;
}

/**
 * Everything the editor is made of, built once when it is created.
 *
 * The callbacks are given as stable functions reading refs, so nothing here has to be rebuilt when
 * the component re-renders — the only part that changes over the editor's life is the schema, which
 * lives in {@link schemaCompartment}.
 */
export function editorSetup(setup: EditorSetup): Extension[] {
  return [
    // Above everything else: the default keymaps leave this chord alone today, but a binding the
    // user reaches for by name is not one to leave to precedence.
    Prec.highest(
      keymap.of([
        {
          key: "Mod-Shift-f",
          preventDefault: true,
          run: () => {
            setup.onFormat();
            return true;
          },
        },
      ])
    ),
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    extraCompletions(setup.completions, setup.dialect),
    highlightSelectionMatches(),
    activeStatement(setup.statementRange),
    sqlLint(setup.lint),
    sqlLookup(setup.lookup),
    // Two spaces, as the textarea this replaced also inserted.
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    schemaCompartment.of(sqlLanguage(setup.schema, setup.database, setup.dialect)),
    editorTheme,
    sqlHighlighting,
    placeholderExt(setup.placeholder),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
      // `F8` walks the problems, `Ctrl+Shift+M` lists them.
      ...lintKeymap,
      // Last, so completion and the default bindings get first refusal on Tab.
      indentWithTab,
    ]),
  ];
}

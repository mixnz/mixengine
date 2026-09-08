import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { StateEffect, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { docText } from "./extensions";

/**
 * One thing wrong with the script, in the terms the editor draws it in.
 *
 * Already translated: this component knows about ranges and severities, not about MySQL or about
 * which language the app is set to. Whoever supplies the sources supplies the sentences.
 */
export interface EditorProblem {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
  /** Which check said so, shown beside the message so a server's opinion reads as the server's. */
  source?: string;
  /** A one-press correction: replaces the problem's range with `text`. */
  fix?: { label: string; text: string };
}

/**
 * Where the editor's problems come from. Two of them, because neither is enough on its own.
 *
 * `quick` costs nothing and covers the whole script, so it runs every time the typing pauses.
 * `deep` is a round trip to the server about one statement, and its answer is the accurate one —
 * only the server knows the dialect of the version actually connected.
 */
export interface LintSources {
  quick: (doc: string) => EditorProblem[];
  /** Asked about the statement at `pos`. Answering with nothing is always allowed — there is no
   *  database selected, a script is running, the connection is busy. */
  deep: (doc: string, pos: number) => Promise<EditorProblem[]>;
}

/** How long the typing has to stop before anything is checked. Long enough that a sentence being
 *  typed is not underlined halfway through, short enough to feel like an answer. */
const IDLE_MS = 400;

/**
 * Ask for the checks to be run again although the text has not changed.
 *
 * CodeMirror re-lints on document changes and on nothing else, so something that changes what the
 * checks *mean* — the schema arriving, a moment after the tab is opened — has to say so. Dispatch
 * this and the linter runs.
 */
export const recheck = StateEffect.define<null>();

/** Puts the checks back on screen for text that has not changed underneath them. */
export function requestRecheck(view: EditorView) {
  view.dispatch({ effects: recheck.of(null) });
}

function toDiagnostic(problem: EditorProblem): Diagnostic {
  const { fix } = problem;
  return {
    from: problem.from,
    to: problem.to,
    severity: problem.severity,
    message: problem.message,
    ...(problem.source ? { source: problem.source } : {}),
    ...(fix
      ? {
          actions: [
            {
              name: fix.label,
              // `from`/`to` rather than the problem's own: the text may have moved since this
              // diagnostic was made, and CodeMirror hands over where it is now.
              apply: (view, from, to) =>
                view.dispatch({ changes: { from, to, insert: fix.text } }),
            },
          ],
        }
      : {}),
  };
}

/**
 * The editor's error checking: the instant answer, and the server's, in one underline layer.
 *
 * CodeMirror applies one lint configuration to every linter in the editor, so the two sources
 * cannot simply be two `linter()` calls with different delays. Instead there is one, and the
 * server's answer is remembered against the exact text it was about: the linter returns what it
 * has and sends the statement off if that text has not been asked about. So the client's findings
 * never wait for the network, and the server's arrive a beat later without anything flickering in
 * between.
 *
 * When the reply lands, the diagnostics are **put on screen directly** rather than by asking for
 * another lint run. `forceLinting` looks like the right call and is not: it only brings forward a
 * run that is already scheduled, and by the time a network reply arrives the run that started it
 * has long since finished, so it does nothing at all. That silence is exactly what it looks like —
 * the server's answer arriving and never being drawn.
 *
 * Note what this deliberately does *not* do: re-check when the caret moves to another statement
 * without the text changing. Re-running the whole script's checks on every arrow key is a cost
 * paid on long scripts for very little — a statement gets checked when it is edited, which is when
 * there is something new to say about it.
 */
export function sqlLint(sources: () => LintSources | null): Extension {
  /** The exact script the server's answer below is about. */
  let checkedDoc: string | null = null;
  let checked: EditorProblem[] = [];
  /** The script a request is out for, so the same one is not asked about twice. */
  let asking: string | null = null;

  return linter(
    (view) => {
      const active = sources();
      if (!active) return [];
      const doc = docText(view.state.doc);
      const problems = active.quick(doc);

      if (checkedDoc === doc) {
        problems.push(...checked);
      } else if (asking !== doc) {
        asking = doc;
        const pos = view.state.selection.main.head;
        void active
          .deep(doc, pos)
          .then((found) => {
            // Measured against the text actually on screen, not against what was last asked
            // about: the two part company as soon as a key is pressed, and drawing an answer
            // about the old text over the new would put the underlines under the wrong words.
            if (docText(view.state.doc) !== doc) return;
            checkedDoc = doc;
            checked = found;
            // The quick findings are taken again rather than reused from the run that sent this
            // request. The text has not changed, but what the checks know about it may have: the
            // schema arriving mid-flight re-runs them with the tables filled in, and replaying the
            // captured set would rub those findings out until the next keystroke. Re-asking costs
            // one pass over the script, once per reply.
            const current = sources();
            const quick = current ? current.quick(doc) : problems;
            view.dispatch(setDiagnostics(view.state, [...quick, ...found].map(toDiagnostic)));
          })
          .catch(() => {
            // A check that could not be made says nothing about the SQL. The connection being
            // busy or gone is reported where the user asked for something, not here.
          })
          .finally(() => {
            if (asking === doc) asking = null;
          });
      }

      return problems.map(toDiagnostic);
    },
    {
      delay: IDLE_MS,
      // Without this the checks would only ever run on a document change, and the schema arriving
      // a moment after the tab opens would leave every table in the script underlined as unknown
      // until the next keystroke.
      needsRefresh: (update) =>
        update.transactions.some((tr) => tr.effects.some((effect) => effect.is(recheck))),
    }
  );
}

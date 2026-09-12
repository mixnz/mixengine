/**
 * A dialog's exit, as a value: whether it is on its way out, what it will say when it gets there,
 * and whether it has said it yet.
 *
 * Split out of [`useDialogExit`](./dialogMotion.ts) so the rule can be stated and tested on its
 * own — what is left around it is animation timing and a ref, neither of which this suite has a
 * DOM to run. The state is handed in and handed back rather than kept here, because the hook holds
 * it in a ref: a second Escape in the same tick has to see the first, and React state would not be
 * there yet.
 */

/** Where a dialog stands between "still up" and "has answered". */
export interface ExitState {
  /** What the dialog tells its caller once the exit animation is done. */
  readonly answer: (() => void) | null;

  /** Whether the dialog is painted on its way out. */
  readonly closing: boolean;

  /** Whether [`answer`](ExitState#answer) has been handed over. */
  readonly delivered: boolean;
}

/** A dialog nobody has answered. Also where one goes back to when it is asked something new. */
export const OPEN: ExitState = { answer: null, closing: false, delivered: false };

/** What can happen to a dialog on its way out. */
export type ExitEvent =
  /** Cancel, Escape, a click on the overlay, or the confirm — every one of them animates out. */
  | { readonly type: "answer"; readonly reply: () => void }
  /** The animation has finished and the caller is being told. */
  | { readonly type: "delivered" }
  /** The dialog is being asked something it was not asking before. */
  | { readonly type: "asked" };

/**
 * The state a dialog moves to, or **the state it was handed back unchanged** — which is the same
 * object, and is how the hook knows an event changed nothing and skips the render.
 *
 * Three rules, and the middle one is the whole of why this exists:
 *
 * - **The first answer wins.** A dialog hears Escape from the window and clicks from its own
 *   overlay, so two answers in one tick is ordinary; the second is ignored.
 * - **A new question reopens it.** A caller may keep a dialog mounted through its own answer to
 *   ask again with what the server just refused. Without this the dialog is left `closing` for
 *   good — `opacity: 0`, `pointer-events: none`, holding the modal count — so the refusal is
 *   shown on a surface nobody can see and the screen has no way back short of a reload.
 * - **Not before the answer is out.** Reopening while the reply is still waiting on the timer
 *   would drop it, and the action somebody confirmed would never run at all.
 */
export function exit(state: ExitState, event: ExitEvent): ExitState {
  switch (event.type) {
    case "answer":
      return state.answer
        ? state
        : { answer: event.reply, closing: true, delivered: false };

    case "delivered":
      return state.answer && !state.delivered ? { ...state, delivered: true } : state;

    case "asked":
      return state.delivered ? OPEN : state;
  }
}

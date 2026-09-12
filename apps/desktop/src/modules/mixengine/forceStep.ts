/**
 * What a destructive call's refusal leaves the dialog to do.
 *
 * Two screens ask the same two-step question — `service.delete` and `runtime.uninstall` both refuse
 * once, name what is in the way, and take `force` to cross it — and both had their own copy of the
 * rule. One copy forgot to close the dialog when the forced attempt was refused too, which is how a
 * dialog ends up mounted with nothing to say.
 */

/** The next question, or the absence of one. */
export type ForceStep =
  /** Ask again in the same dialog, showing what the daemon refused with. */
  | { readonly ask: "force"; readonly hint: string }
  /** Nothing left to ask: close the dialog and put the refusal in the banner. */
  | { readonly ask: "none"; readonly error: string };

/**
 * What to do with `message`, the refusal a delete or an uninstall came back with.
 *
 * `forced` is whether the attempt that was refused had already sent `force`. **Being asked a
 * second time does not mean force will work**: `service.delete` refuses a running service above
 * the branch force is allowed to cross, so the forced attempt can come back refused for a reason
 * force will never get past. Which is why the second refusal ends the asking rather than starting
 * it again — the person reads the daemon's own sentence, and its hint, and decides.
 */
export function afterRefusal(forced: boolean, message: string): ForceStep {
  return forced ? { ask: "none", error: message } : { ask: "force", hint: message };
}

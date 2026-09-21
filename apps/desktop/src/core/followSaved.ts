/**
 * What a form showing a saved entry does when the saved list changes under it: sync brought a newer
 * one, or another tab saved or deleted it.
 *
 * - `none`: the entry is as it was when the form took it.
 * - `reload`: the form was not edited (or already says what the entry now says), so it takes the
 *   new entry quietly.
 * - `changed`: the form holds edits, which are the person's and are kept; they are told.
 * - `removed`: the entry is gone. The form stays, and saving it makes a new one.
 *
 * Each argument is the same stable snapshot of an entry: `current` as the list has it now (or
 * `undefined` when it is not in the list), `applied` as it was when the form took it (`null` when
 * the form took none), and `form` as the form holds it.
 */
export type SavedChange = "none" | "reload" | "changed" | "removed";

export function savedChange(current: string | undefined, applied: string | null, form: string): SavedChange {
  if (applied === null) return "none";
  if (current === undefined) return "removed";
  if (current === applied) return "none";
  return form === applied || form === current ? "reload" : "changed";
}

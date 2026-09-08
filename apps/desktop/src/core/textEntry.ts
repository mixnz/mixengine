/**
 * Where the user types, and so where the webview's own editing is left alone.
 *
 * Two gestures need the same answer to this. `Ctrl+A` outside a text field means "select the chrome
 * of the app", which nobody wants, so {@link ./App} swallows it — but inside one it is select-all
 * and has to reach the field. A right-click outside a text field opens a browser menu that means
 * nothing here, so {@link ./nativeContextMenu} refuses it — but inside one it is cut, copy and
 * paste, which no part of the app replaces.
 *
 * They were written separately and drifted, which is the whole reason this sits in one place: two
 * spellings of "somewhere the user types" answer differently for the same element sooner or later,
 * and the gestures then disagree about the same field.
 */

/** The input types that hold nothing to select, copy or paste — a tickbox, a colour swatch, a
 *  button wearing an `<input>`. They are `<input>` elements and nothing else about them is
 *  text. `HTMLInputElement.type` is already lowercased, and reads `text` for a missing or
 *  unrecognised attribute, so an input the app forgot to type is treated as one that holds text. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether an event landed somewhere the user types.
 *
 * `isContentEditable` is what covers the query editor: CodeMirror builds it out of an editable
 * `<div>` rather than a `<textarea>`, and it is true on the spans inside it as well as on the
 * editor's own element, so a click anywhere in the script answers yes.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target.isContentEditable;
}

/**
 * Putting text on the system clipboard.
 *
 * One place rather than a `navigator.clipboard` call at each site, because the call fails in ways
 * worth answering the same way everywhere: the webview hands the clipboard out only to a secure
 * context and only under a gesture the user made, and a copy that quietly did nothing is the worst
 * of the possible outcomes — the user pastes whatever was on the clipboard before and finds out
 * somewhere else.
 *
 * So a refusal falls back to the old `execCommand` route, which is not held to the same rules, and
 * only a failure of both is reported. What is thrown then is an {@link AppError} like any other, so
 * callers put it through `errorMessage` and show it on the banner they already have.
 */
import type { AppError } from "./errors";

/**
 * The clipboard the way it worked before `navigator.clipboard` existed: a textarea holding the
 * text, selected, copied and taken away again.
 *
 * Off-screen rather than hidden — `display: none` or the `hidden` attribute would leave nothing to
 * select, and the copy would take whatever the page had selected instead. Focus goes back where it
 * was afterwards, or the grid would lose its keyboard to a box that no longer exists.
 */
function copyByExecCommand(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  const previous = document.activeElement;
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}

/** Puts `text` on the clipboard, rejecting with an `error.clipboard` {@link AppError} when the
 *  webview refuses both routes. */
export async function copyText(text: string): Promise<void> {
  try {
    // Not `navigator.clipboard?.` — outside a secure context the property is missing altogether,
    // and reading through it throws rather than resolving, which is what the catch is for.
    await navigator.clipboard.writeText(text);
    return;
  } catch (e) {
    if (copyByExecCommand(text)) return;
    const error: AppError = { code: "error.clipboard", params: { message: String(e) } };
    throw error;
  }
}

/** Puts `blob` on the clipboard as an image, rejecting with an `error.clipboard` {@link AppError}
 *  when the webview refuses it. No `execCommand`-style fallback exists for images the way it does
 *  for text — that route only ever copied text. */
export async function copyImage(blob: Blob): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  } catch (e) {
    const error: AppError = { code: "error.clipboard", params: { message: String(e) } };
    throw error;
  }
}

/**
 * Where Tab goes inside a dialog.
 *
 * Apart from the component so it can be checked without a DOM: the wrap-around is the half that
 * can be wrong, and it is wrong in a way nobody notices by looking — focus leaves the dialog for
 * the page behind it, which is only visible if you keep pressing Tab.
 */

/** What counts as somewhere focus can land. `[tabindex="-1"]` is deliberately not in it: an element
 *  focus can be *put* on is not one Tab should stop at. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The index Tab moves to from `current`, wrapping at either end.
 *
 * `current` is -1 when focus is on the dialog itself or has drifted outside it, in which case Tab
 * starts at the top and Shift+Tab at the bottom — which is what keeps a stray focus from escaping
 * on the very next press.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

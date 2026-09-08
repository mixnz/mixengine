/** Where the list has to be scrolled to for one option to sit in the middle of it. */
export interface CenterScrollInput {
  /** How far the option starts from the top of the whole list, not of the visible part. */
  itemTop: number;
  itemHeight: number;
  /** The height of the list as seen — what fits between the menu's edges. */
  viewportHeight: number;
  /** The height of everything in the list, seen or not. */
  scrollHeight: number;
}

/**
 * The `scrollTop` that centres one option in the list, as far as the list allows.
 *
 * "As far as it allows" is the clamp, and it is the whole reason this is worth its own function:
 * the first options in a menu can never reach the middle without the list scrolling above its own
 * top, and the last ones cannot without it scrolling below its bottom. Both are answered by
 * holding the corresponding end, which is also what the browser would do with the number — asking
 * for it here means the caller reads the same value back it wrote, and the tests have something to
 * assert on that no layout has to run to produce.
 *
 * A list too short to scroll is the same case reached from the other side: its whole range is zero
 * wide, so every option is already as centred as it will get and the answer is 0.
 */
export function centeredScrollTop({
  itemTop,
  itemHeight,
  viewportHeight,
  scrollHeight,
}: CenterScrollInput): number {
  const centred = itemTop + itemHeight / 2 - viewportHeight / 2;
  const furthest = Math.max(0, scrollHeight - viewportHeight);
  return Math.min(Math.max(centred, 0), furthest);
}

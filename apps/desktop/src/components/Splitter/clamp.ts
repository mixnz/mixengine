/**
 * Where a divider ends up, given where the drag started and how far it has gone.
 *
 * Kept apart from the component because it is the half that can be wrong: the drag itself is four
 * event listeners, and this is the arithmetic that decides whether a pane can be dragged shut.
 */

/** A pane's new size in pixels. */
export function clampSize(start: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, start + delta));
}

/** A pane's new share of the space, for a divider that splits by ratio rather than by width.
 *  A container with no width yet gives no share to compute, so the ratio is left as it was. */
export function clampRatio(
  start: number,
  deltaPx: number,
  totalPx: number,
  min: number,
  max: number,
): number {
  if (totalPx <= 0) return start;
  return Math.min(max, Math.max(min, start + deltaPx / totalPx));
}

/**
 * When a server's announced end (D4b) is near enough to say so outside Settings. The Sync pane
 * always shows the date; the strip under the tab bar waits for this, because a warning shown for
 * months is one nobody reads.
 */
export const NEAR_DAYS = 30;

const DAY_MS = 86_400_000;

/** Whole days from `now` (milliseconds) to `closingOn` (seconds), rounding up. */
export function daysUntil(closingOn: number, now: number): number {
  return Math.ceil((closingOn * 1000 - now) / DAY_MS);
}

export function closingSoon(closingOn: number | null, now: number): boolean {
  return closingOn !== null && daysUntil(closingOn, now) <= NEAR_DAYS;
}

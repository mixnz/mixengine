/**
 * The parts of the theme that are decisions rather than side effects, kept free of `document`,
 * `window` and `localStorage` so they run under Vitest's node environment.
 */

/** Keys earlier builds wrote that nothing reads any more. */
export const RETIRED_KEYS: readonly string[] = ["mixdb-glass"];

/** Forgets settings whose feature is gone, so a stale value cannot surprise a later build. */
export function clearRetiredKeys(storage: Pick<Storage, "removeItem">): void {
  for (const key of RETIRED_KEYS) storage.removeItem(key);
}

export type ResolvedTheme = "light" | "dark";

/** What `data-theme` carries for a stored preference. *System* is settled here, against the OS,
 *  so no stylesheet has to restate its dark rules under a media query. */
export function resolveTheme(mode: "light" | "dark" | "system", prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

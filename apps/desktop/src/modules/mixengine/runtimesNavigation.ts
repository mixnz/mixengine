/**
 * One-way bridge into Runtimes: "open Runtimes, on Languages, already searching for X".
 *
 * Same shape as `sitesNavigation.ts` — one module-level variable rather than a React context,
 * because a MixEngine tab holds exactly one Runtimes at a time.
 *
 * **Two readers, one token.** `Runtimes` owns which tab is on screen, `Languages` owns the search
 * box — so the parent *peeks* and the child *takes*. `Languages` only takes while it is active,
 * which already implies the Languages tab is the one showing, so the child can never swallow the
 * token before the parent has switched to it.
 */
let pendingLanguageFilter: string | null = null;

/** Ask the next visit to Runtimes to land on Languages with this text in its search box. */
export function requestRuntimesLanguageFilter(filter: string): void {
  pendingLanguageFilter = filter;
}

/** Whether a request is waiting, without consuming it. */
export function peekPendingRuntimesFilter(): string | null {
  return pendingLanguageFilter;
}

/**
 * `take` rather than `peek` — read once, then clear, so a stale navigation request cannot overwrite
 * a search the user has since typed themselves.
 */
export function takePendingRuntimesFilter(): string | null {
  const filter = pendingLanguageFilter;
  pendingLanguageFilter = null;
  return filter;
}

/**
 * What a REST tab remembers between launches: which requests were on its strip and which of them
 * was in front.
 *
 * Ids and only ids. The requests themselves — the URL, the headers, the body, the auth — live in
 * `rest-requests.json`, and nothing about them is copied here; see §4 of
 * `docs/superpowers/specs/2026-08-23-tab-session-context-design.md`.
 *
 * Nothing is sent on the way back. Reopening a request is opening its pane, exactly as clicking it
 * in the sidebar is.
 */
export interface RestTabState {
  openIds: string[];
  /** One of `openIds` when it was written, but not necessarily when it is read back: the request
   *  may have been deleted meanwhile, and the restoring side re-checks. */
  activeId: string | null;
}

/**
 * The stored value, if it is one, or `null`.
 *
 * This is where validation lives — the shell passes the slot through untouched on purpose. An
 * empty strip comes out `null`: there is nothing to reopen, and the writing side forgets the state
 * rather than storing that.
 */
export function parseRestTabState(value: unknown): RestTabState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.openIds) || state.openIds.length === 0) return null;
  if (!state.openIds.every((id) => typeof id === "string" && id !== "")) return null;
  const openIds = state.openIds as string[];

  if (state.activeId === null) return { openIds: [...openIds], activeId: null };
  if (typeof state.activeId === "string") return { openIds: [...openIds], activeId: state.activeId };
  return null;
}

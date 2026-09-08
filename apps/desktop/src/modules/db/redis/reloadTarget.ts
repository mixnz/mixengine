/**
 * Which half of the Redis workspace `Ctrl+R` belongs to.
 *
 * Two panes are on screen at once and both have a reload of their own — the keyspace on the left,
 * the open key's value on the right — so the key has to be pointed at one of them. The rule is the
 * one a user would state: reload what I am looking at, and the keyspace when that is nothing.
 */
export type ReloadPane = "left" | "right";

/**
 * Picks the pane, given the one last touched and whether the right has anything in it.
 *
 * `focus` is the pane the user last reached into — clicked, tabbed into, or opened a key in — or
 * null before they have touched either. It wins when it can, because a user who has just put the
 * cursor somewhere means that somewhere.
 *
 * `rightLoaded` is the veto: the right pane only answers while it is showing a value. The prompt to
 * pick a key has nothing to re-read, and the group pane is built out of the names the sidebar
 * already scanned — reloading it *is* rescanning the keyspace. Both fall to the left rather than
 * to a reload that would do nothing.
 */
export function reloadTarget(focus: ReloadPane | null, rightLoaded: boolean): ReloadPane {
  if (!rightLoaded) return "left";
  if (focus !== null) return focus;
  return "right";
}

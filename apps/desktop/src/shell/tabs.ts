import type { TabBadge } from "./module";

/**
 * What the tab bar knows about one open tab, and the two ways a module changes it.
 *
 * Both updaters hand back **the array they were given** when the change is no change. That is not
 * an optimisation: a module reports its title from an effect, the shell passes a fresh callback on
 * every render, and a `setTabs` that always allocates turns the pair into a render loop that
 * React stops with "Maximum update depth exceeded". Bailing out here breaks the loop for every
 * module, including the ones not written yet.
 */
export interface TabInfo {
  id: string;
  /** Which module's workspace this tab holds. Looked up in the registry to render it. */
  moduleId: string;
  title: string;
  /** What the module asked the tab bar to show for it. Reported rather than worked out up here:
   *  only the module knows what its own state means — see {@link TabBadge}. */
  badges: TabBadge[];
  /** Whatever the module asked to have kept for this tab between launches. Opaque here: the shell
   *  carries it to `localStorage` and back and never reads it — see `shell/session.ts`. */
  state?: unknown;
}

/**
 * The tab `delta` places along from the active one, wrapping round both ends.
 *
 * Strip order rather than the order tabs were last looked at: that is what every browser's
 * `Ctrl+Tab` does, and a cycle whose next stop depends on where you have been is one you cannot
 * find your way round by looking at the strip.
 *
 * Hands back `activeId` when there is nowhere else to go — no tabs, one tab, or an id that is not
 * in the list — so the caller has nothing to check for.
 */
export function tabIdAtOffset(tabs: TabInfo[], activeId: string, delta: number): string {
  const at = tabs.findIndex((t) => t.id === activeId);
  if (at < 0 || tabs.length === 0) return activeId;
  // `+ tabs.length` before the modulo: JavaScript's `%` keeps the sign of its left side, so -1
  // would land on -1 rather than on the last tab.
  return tabs[(at + delta + tabs.length) % tabs.length].id;
}

export function retitleTab(tabs: TabInfo[], id: string, title: string): TabInfo[] {
  const tab = tabs.find((t) => t.id === id);
  if (tab === undefined || tab.title === title) return tabs;
  return tabs.map((t) => (t === tab ? { ...t, title } : t));
}

/** Compared by identity, not contents: a badge holds a React element, which nothing can compare
 *  by value, and every module builds its list with `useMemo` for exactly this reason. */
export function rebadgeTab(tabs: TabInfo[], id: string, badges: TabBadge[]): TabInfo[] {
  const tab = tabs.find((t) => t.id === id);
  if (tab === undefined || tab.badges === badges) return tabs;
  return tabs.map((t) => (t === tab ? { ...t, badges } : t));
}

/**
 * What the module wants remembered for this tab, or `undefined` to forget it.
 *
 * Compared with `Object.is`, exactly as {@link rebadgeTab} compares badges and for the same
 * reason: this is fed from a module's effect, `App` hands down a fresh callback on every render,
 * and a `setTabs` that always allocates closes the loop. Which means the module must not build a
 * new state object on every render either — the bail-out here can only catch what is handed to it.
 */
export function restateTab(tabs: TabInfo[], id: string, state: unknown): TabInfo[] {
  const tab = tabs.find((t) => t.id === id);
  if (tab === undefined || Object.is(tab.state, state)) return tabs;
  return tabs.map((t) => (t === tab ? { ...t, state } : t));
}

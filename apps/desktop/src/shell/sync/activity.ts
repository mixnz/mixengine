import { useSyncExternalStore } from "react";
import type { RunResult } from "./loop";

/** A run shorter than this never shows: a push that found nothing to send takes a few ms. */
export const SHOW_AFTER_MS = 200;

/** Once shown, this long at least, so a run does not flash the spinner on and off. */
export const SHOW_AT_LEAST_MS = 600;

export interface SyncActivity {
  /** Whether the spinner shows. */
  syncing: boolean;
  /** When the last full run finished without a failure, in ms since the epoch. */
  lastSyncedAt: number | null;
  /** The first failure of the last run that had one, until a full run succeeds; `undefined` when none. */
  lastError: unknown;
}

export interface ActivityStore {
  /** For `useSyncExternalStore`: stable. */
  subscribe: (listener: () => void) => () => void;
  /** The same object until something changes. */
  get: () => SyncActivity;
  runStarted: () => void;
  runEnded: (result: RunResult) => void;
}

/**
 * The loop's runs, as the window draws them. In memory, like `replaced.ts`: the Settings dialog
 * that shows most of it is not mounted while sync runs.
 */
export function createActivity(): ActivityStore {
  let value: SyncActivity = { syncing: false, lastSyncedAt: null, lastError: undefined };
  const listeners = new Set<() => void>();
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownAt = 0;

  function set(next: Partial<SyncActivity>): void {
    value = { ...value, ...next };
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => value,
    runStarted() {
      // The next run began while the last one's spinner was still being held: keep turning.
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
        return;
      }
      if (value.syncing || showTimer !== null) return;
      showTimer = setTimeout(() => {
        showTimer = null;
        shownAt = Date.now();
        set({ syncing: true });
      }, SHOW_AFTER_MS);
    },
    runEnded({ run, error, finished }) {
      if (error !== undefined) set({ lastError: error });
      else if (run === "full" && finished) set({ lastSyncedAt: Date.now(), lastError: undefined });

      if (showTimer !== null) {
        clearTimeout(showTimer);
        showTimer = null;
        return;
      }
      if (!value.syncing) return;
      hideTimer = setTimeout(
        () => {
          hideTimer = null;
          set({ syncing: false });
        },
        Math.max(0, SHOW_AT_LEAST_MS - (Date.now() - shownAt)),
      );
    },
  };
}

/** The one the loop reports to (`index.ts`) and the window reads. */
export const syncActivity = createActivity();

export function useSyncActivity(): SyncActivity {
  return useSyncExternalStore(syncActivity.subscribe, syncActivity.get);
}

/**
 * How long ago `at` was, in the app's language: "2 minutes ago", "3 hours ago". `null` under a
 * minute, where a sentence of its own ("just now") reads better than "0 minutes ago".
 */
export function syncedAgo(at: number, now: number, lang: string): string | null {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return null;
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "always" });
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.floor(hours / 24), "day");
}

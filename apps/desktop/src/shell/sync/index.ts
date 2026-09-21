import { logError } from "../../core/log";
import { SYNCABLE } from "../registry";
import { tauriSync } from "./api";
import { readEnabled } from "./enabled";
import { startSyncLoop } from "./loop";

/** Fired on `window` with `{ collection, count }` when edits made here were replaced by newer ones. */
export const SYNC_REPLACED_EVENT = "mixlab:sync-replaced";

/**
 * Sync for the main window: every collection that is on, at D8's moments. With every row off —
 * which is how a machine starts (D5) — it runs and asks nothing of anybody. Returns the stop.
 */
export function startSync(): () => void {
  return startSyncLoop({
    backend: tauriSync,
    collections: () => {
      const on = readEnabled(localStorage);
      return SYNCABLE.filter((collection) => on.has(collection.id));
    },
    onFocus: (listener) => {
      window.addEventListener("focus", listener);
      return () => window.removeEventListener("focus", listener);
    },
    onReplaced: (collection, count) =>
      window.dispatchEvent(new CustomEvent(SYNC_REPLACED_EVENT, { detail: { collection, count } })),
    // An `AppError` is a plain object, which `String()` would print as `[object Object]`.
    onError: (collection, error) =>
      void logError("sync", error instanceof Error ? error : JSON.stringify(error), collection),
  });
}

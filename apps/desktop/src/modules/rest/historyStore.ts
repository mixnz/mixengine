import { createStore, jsonFile, useStore } from "../../core/jsonStore";
import { withEntry, withoutBodies, withoutEntry, type HistoryEntry } from "./history";

/**
 * Everything this app has sent, newest first, shared by every REST tab.
 *
 * Written on every send and read only when the dialog is opened — which is usually much later in a
 * session. That gap is why {@link recordSend} waits for the file: an entry added to an empty list
 * and written back would be the whole history, and every earlier session would be gone.
 */

const store = createStore<HistoryEntry[]>({
  defaults: [],
  ...jsonFile<HistoryEntry[]>("rest-history.json", "entries", []),
});

/** Publish and write behind. A history that could not be written is not worth interrupting anyone
 *  over, and it is still right in memory. */
function keep(list: HistoryEntry[]): void {
  void store.save(list).catch(() => {});
}

export function useHistory(): HistoryEntry[] {
  return useStore(store);
}

/** Adds a send to the front of the list, once the file it belongs at the front of has been read. */
export function recordSend(entry: HistoryEntry): void {
  void store.ready().then(
    () => keep(withEntry(store.get(), entry)),
    // The file could not be read. The send is still worth showing for the rest of the session, but
    // nothing is written back: what is on disk is unknown, and writing over it would lose it.
    () => store.remember(withEntry(store.get(), entry)),
  );
}

export function forgetEntry(id: string): void {
  void store.ready().then(() => keep(withoutEntry(store.get(), id)), () => {});
}

export function clearHistory(): void {
  void store.ready().then(() => keep([]), () => {});
}

/**
 * Forgets every stored body, keeping the entries themselves.
 *
 * What turning *Keep response bodies* off does. Stopping there and only refusing new ones would not
 * be enough: a switch about privacy that leaves what it already wrote sitting on disk is a lie.
 */
export function dropHistoryBodies(): void {
  void store.ready().then(() => {
    const list = withoutBodies(store.get());
    if (list !== store.get()) keep(list);
  }, () => {});
}

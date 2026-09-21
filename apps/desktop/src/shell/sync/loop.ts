import type { SyncChanges, SyncableCollection } from "../../core/syncCollection";
import type { SyncBackend } from "./api";

/**
 * How often this machine looks, locally, for something it has not lent yet. A look that finds
 * nothing costs no request — Rust compares hashes before it opens a socket — so this is how *"on a
 * local change, after a debounce"* (D8, rule 1) is met without every module announcing its writes.
 */
export const LOCAL_CHECK_MS = 30_000;

/** How long a window goes without news before it asks for some anyway (D8, rule 1). */
export const IDLE_PULL_MS = 15 * 60_000;

function isEmpty(changes: SyncChanges): boolean {
  return changes.upserts.length === 0 && changes.removed.length === 0;
}

/**
 * One collection, both ways: every page pulled and written, then this machine's changes pushed.
 * Resolves to how many of this machine's edits newer ones replaced (D4).
 *
 * **Nothing is committed before the module has written it.** A write that throws leaves its page,
 * or a lost conflict's winner, uncommitted — so the next run meets it again, rather than recording
 * an agreement the disk does not hold.
 */
export async function syncCollection(backend: SyncBackend, collection: SyncableCollection): Promise<number> {
  for (;;) {
    const page = await backend.pullPage(collection.id);
    if (!isEmpty(page.changes)) await collection.write(page.changes);
    await backend.commitPull(collection.id, page.token);
    if (!page.more) break;
  }
  return pushCollection(backend, collection);
}

/** This machine's changes alone — what the local check runs, without asking the server for news. */
export async function pushCollection(backend: SyncBackend, collection: SyncableCollection): Promise<number> {
  const pushed = await backend.push(collection.id, await collection.read());
  if (pushed.token === null) return 0;
  if (!isEmpty(pushed.replaced)) await collection.write(pushed.replaced);
  await backend.commitPush(collection.id, pushed.token);
  return pushed.replaced.upserts.length + pushed.replaced.removed.length;
}

export interface LoopOptions {
  backend: SyncBackend;
  /** The collections that are on, asked at every run so turning one on takes effect at the next. */
  collections: () => SyncableCollection[];
  /** Subscribes to the window gaining focus; returns the unsubscribe. */
  onFocus: (listener: () => void) => () => void;
  /** Edits made here that newer ones replaced — for a notice, never a question (D4). */
  onReplaced: (collectionId: string, count: number) => void;
  onError: (collectionId: string, error: unknown) => void;
}

type Run = "full" | "push";

/**
 * The one lane every loop's runs take, whichever loop they belong to. A window that remounts its
 * workspace (StrictMode, a hot reload) stops one loop and starts another while the first is still
 * writing; two runs applying the same page each see an id missing and each add it.
 */
let lane: Promise<void> = Promise.resolve();

function inLane(run: () => Promise<void>): Promise<void> {
  const next = lane.then(run, run);
  lane = next.catch(() => {});
  return next;
}

/** Signed out: every collection would say the same, and none of it is news. */
function isSignedOut(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "error.syncNotSignedIn"
  );
}

/**
 * Sync at D8's moments: at launch, on focus, a local check every {@link LOCAL_CHECK_MS}, and a
 * pull when nothing has been heard for {@link IDLE_PULL_MS}. **One run at a time**, across every
 * loop there is: a moment that arrives during a run asks for one more, however many arrive, and a
 * loop started while a stopped one is still writing waits for it. Returns the stop.
 */
export function startSyncLoop(options: LoopOptions): () => void {
  let running = false;
  let queued: Run | null = null;
  let stopped = false;
  let lastFull = 0;

  async function runOnce(run: Run): Promise<void> {
    if (run === "full") lastFull = Date.now();
    for (const collection of options.collections()) {
      // A stopped loop finishes the collection it is in, and starts no other.
      if (stopped) return;
      try {
        const replaced =
          run === "full"
            ? await syncCollection(options.backend, collection)
            : await pushCollection(options.backend, collection);
        if (replaced > 0) options.onReplaced(collection.id, replaced);
      } catch (error) {
        if (isSignedOut(error)) return;
        options.onError(collection.id, error);
      }
    }
  }

  function ask(run: Run): void {
    if (stopped) return;
    if (running) {
      queued = queued === "full" || run === "full" ? "full" : "push";
      return;
    }
    running = true;
    void (async () => {
      let next: Run | null = run;
      while (next !== null && !stopped) {
        const run = next;
        await inLane(() => runOnce(run));
        next = queued;
        queued = null;
      }
      running = false;
    })();
  }

  ask("full");
  const unfocus = options.onFocus(() => ask("full"));
  const timer = setInterval(() => ask(Date.now() - lastFull >= IDLE_PULL_MS ? "full" : "push"), LOCAL_CHECK_MS);
  return () => {
    stopped = true;
    unfocus();
    clearInterval(timer);
  };
}

/**
 * Runs the steps it is given one after another, each starting only once the one before has settled.
 *
 * For a pair of calls whose order the backend does not promise — opening a stream and closing it
 * again. Sent side by side, a close issued for an old opening could land after a new opening and
 * close that instead. Queued, every close reaches the backend after the opening it belongs to, and
 * every opening after the close before it.
 *
 * A step that fails is dropped; the queue carries on with the next.
 */
export type SerialQueue = (step: () => Promise<unknown>) => void;

export function serialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return (step) => {
    tail = tail.then(step).catch(() => undefined);
  };
}

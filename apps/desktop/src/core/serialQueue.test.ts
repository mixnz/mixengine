import { describe, expect, it } from "vitest";

import { serialQueue } from "./serialQueue";

/** A promise that settles when the test says so. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("serialQueue", () => {
  // The Dashboard's case: a close queued behind a slow opening, then a new opening. The second
  // opening must not start before the close, or the close would end it.
  it("starts a step only once the one before has settled", async () => {
    const enqueue = serialQueue();
    const calls: string[] = [];
    const opening = deferred();

    enqueue(() => {
      calls.push("open 1");
      return opening.promise;
    });
    enqueue(async () => {
      calls.push("close 1");
    });
    enqueue(async () => {
      calls.push("open 2");
    });

    await settle();
    expect(calls).toEqual(["open 1"]);

    opening.resolve();
    await settle();
    expect(calls).toEqual(["open 1", "close 1", "open 2"]);
  });

  it("carries on after a step that fails", async () => {
    const enqueue = serialQueue();
    const calls: string[] = [];
    const opening = deferred();

    enqueue(() => opening.promise);
    enqueue(async () => {
      calls.push("close");
    });

    opening.reject(new Error("the daemon is not running"));
    await settle();
    expect(calls).toEqual(["close"]);
  });
});

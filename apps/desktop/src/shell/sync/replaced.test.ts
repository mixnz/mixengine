import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearReplaced, noteReplaced, onReplacedChange, replacedCounts } from "./replaced";

describe("edits replaced by newer ones", () => {
  beforeEach(() => clearReplaced());

  it("add up per collection until they are dismissed", () => {
    noteReplaced("connections", 2);
    noteReplaced("connections", 1);
    noteReplaced("preferences", 1);
    expect([...replacedCounts()]).toEqual([
      ["connections", 3],
      ["preferences", 1],
    ]);
    clearReplaced();
    expect(replacedCounts().size).toBe(0);
  });

  it("dismissed one collection at a time, leave the others to be read", () => {
    // Each collection has its own notice; dismissing one cleared them all, unread.
    noteReplaced("connections", 2);
    noteReplaced("preferences", 1);
    clearReplaced("connections");
    expect([...replacedCounts()]).toEqual([["preferences", 1]]);
  });

  it("tell whoever is listening, until they stop", () => {
    const listener = vi.fn();
    const stop = onReplacedChange(listener);
    noteReplaced("connections", 1);
    stop();
    noteReplaced("connections", 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

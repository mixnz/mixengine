import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivity, SHOW_AFTER_MS, SHOW_AT_LEAST_MS, syncedAgo } from "./activity";

describe("the spinner", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("never shows for a run shorter than the delay", () => {
    const store = createActivity();
    store.runStarted();
    vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
    store.runEnded({ run: "push", error: undefined, finished: true });
    vi.advanceTimersByTime(SHOW_AT_LEAST_MS);
    expect(store.get().syncing).toBe(false);
  });

  it("shows for a long run, and stays at least the minimum once shown", () => {
    const store = createActivity();
    store.runStarted();
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(store.get().syncing).toBe(true);
    store.runEnded({ run: "full", error: undefined, finished: true });
    vi.advanceTimersByTime(SHOW_AT_LEAST_MS - 1);
    expect(store.get().syncing).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.get().syncing).toBe(false);
  });

  it("keeps turning through back-to-back runs", () => {
    const store = createActivity();
    store.runStarted();
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    store.runEnded({ run: "full", error: undefined, finished: true });
    store.runStarted();
    vi.advanceTimersByTime(SHOW_AT_LEAST_MS * 2);
    expect(store.get().syncing).toBe(true);
  });

  it("tells its subscribers, and hands out the same value until something changes", () => {
    const store = createActivity();
    const heard = vi.fn();
    store.subscribe(heard);
    const before = store.get();
    expect(store.get()).toBe(before);
    store.runStarted();
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(heard).toHaveBeenCalled();
    expect(store.get()).not.toBe(before);
  });
});

describe("what the last run leaves behind", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => void vi.useRealTimers());

  it("records when a full run finished cleanly", () => {
    const store = createActivity();
    store.runEnded({ run: "full", error: undefined, finished: true });
    expect(store.get()).toMatchObject({ lastSyncedAt: 1_000_000, lastError: undefined });
  });

  it("does not count a push, or a run that stopped early, as a sync", () => {
    const store = createActivity();
    store.runEnded({ run: "push", error: undefined, finished: true });
    store.runEnded({ run: "full", error: undefined, finished: false });
    expect(store.get().lastSyncedAt).toBeNull();
  });

  it("keeps a failure until a full run succeeds", () => {
    const store = createActivity();
    const failure = new Error("offline");
    store.runEnded({ run: "full", error: failure, finished: true });
    store.runEnded({ run: "push", error: undefined, finished: true });
    expect(store.get().lastError).toBe(failure);
    store.runEnded({ run: "full", error: undefined, finished: true });
    expect(store.get().lastError).toBeUndefined();
  });
});

describe("syncedAgo", () => {
  const minute = 60_000;

  it("says nothing under a minute, so the caller can say just now", () => {
    expect(syncedAgo(0, 59_000, "en")).toBeNull();
    expect(syncedAgo(10_000, 0, "en")).toBeNull();
  });

  it("counts minutes, then hours, then days, in the app's language", () => {
    expect(syncedAgo(0, 2 * minute, "en")).toBe("2 minutes ago");
    expect(syncedAgo(0, 3 * 60 * minute, "en")).toBe("3 hours ago");
    expect(syncedAgo(0, 2 * 24 * 60 * minute, "en")).toBe("2 days ago");
    expect(syncedAgo(0, 2 * minute, "vi")).toBe("2 phút trước");
  });
});

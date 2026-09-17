import { describe, expect, it } from "vitest";

import { applyLogFrame, countStreams, filterByStream, type LogEntry } from "./logState";

const MIXED: LogEntry[] = [
  { kind: "historic", text: "from the file" },
  { kind: "line", stream: "stdout", at: "", text: "out" },
  { kind: "gap", missed: 3 },
  { kind: "line", stream: "stderr", at: "", text: "err one" },
  { kind: "line", stream: "stderr", at: "", text: "err two" },
];

describe("countStreams", () => {
  it("counts every printed line under all, and a historic one under neither stream", () => {
    expect(countStreams(MIXED)).toEqual({ all: 4, stdout: 1, stderr: 2, historic: 1 });
  });
});

describe("filterByStream", () => {
  it("leaves everything under all", () => {
    expect(filterByStream(MIXED, "all")).toEqual(MIXED);
  });

  /* A line read back from the file has no stream, so no stream filter can honestly keep it. */
  it("hides historic lines under a stream and keeps the gap", () => {
    expect(filterByStream(MIXED, "stderr")).toEqual([MIXED[2], MIXED[3], MIXED[4]]);
    expect(filterByStream(MIXED, "stdout")).toEqual([MIXED[1], MIXED[2]]);
  });
});

describe("applyLogFrame", () => {
  it("appends a line frame", () => {
    const raw = JSON.stringify({ type: "line", stream: "stdout", at: "2026-09-06T00:00:00Z", text: "hi" });
    expect(applyLogFrame([], raw, 100)).toEqual([
      { kind: "line", stream: "stdout", at: "2026-09-06T00:00:00Z", text: "hi" },
    ]);
  });

  /* The daemon stores what the program wrote, escape codes and all; a pane has no terminal to
     honour them, so they come off here rather than once per line per render. `--ansi` in Laravel's
     own composer.json is what puts them there, so no flag on our side can stop them at the source. */
  it("takes the terminal colour out of a line", () => {
    const raw = JSON.stringify({
      type: "line",
      stream: "stdout",
      at: "2026-09-06T00:00:00Z",
      text: "  laravel/tinker \x1b[32;1mDONE\x1b[39;22m",
    });
    expect(applyLogFrame([], raw, 100)).toEqual([
      { kind: "line", stream: "stdout", at: "2026-09-06T00:00:00Z", text: "  laravel/tinker DONE" },
    ]);
  });

  /* Replayed history came off the same pipe and carries the same codes. */
  it("takes the terminal colour out of a historic line too", () => {
    const raw = JSON.stringify({ type: "historic", text: "\x1b[37;44m INFO \x1b[39;49m ready" });
    expect(applyLogFrame([], raw, 100)).toEqual([{ kind: "historic", text: " INFO  ready" }]);
  });

  it("appends a historic frame with no stream or timestamp", () => {
    const raw = JSON.stringify({ type: "historic", text: "old line" });
    expect(applyLogFrame([], raw, 100)).toEqual([{ kind: "historic", text: "old line" }]);
  });

  it("appends a gap marker rather than dropping it silently", () => {
    const raw = JSON.stringify({ type: "gap", missed: 12 });
    expect(applyLogFrame([], raw, 100)).toEqual([{ kind: "gap", missed: 12 }]);
  });

  it("ignores an unparseable message rather than throwing", () => {
    expect(applyLogFrame([], "not json", 100)).toEqual([]);
  });

  it("ignores an unknown frame type rather than throwing", () => {
    const raw = JSON.stringify({ type: "something_new" });
    expect(applyLogFrame([], raw, 100)).toEqual([]);
  });

  it("bounds the list to maxEntries, dropping the oldest first", () => {
    const existing: LogEntry[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "historic",
      text: `line ${i}`,
    }));
    const raw = JSON.stringify({ type: "historic", text: "line 5" });
    const result = applyLogFrame(existing, raw, 3);
    expect(result).toEqual([
      { kind: "historic", text: "line 3" },
      { kind: "historic", text: "line 4" },
      { kind: "historic", text: "line 5" },
    ]);
  });
});

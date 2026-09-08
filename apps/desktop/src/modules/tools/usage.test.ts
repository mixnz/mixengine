import { describe, expect, it } from "vitest";
import { USAGE_WINDOW_MS, clearUse, rankFrequentTools, recordUse, sanitizeUsage } from "./usage";

const NOW = Date.parse("2026-09-03T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("sanitizeUsage", () => {
  it("gives an empty record when there is nothing stored", () => {
    expect(sanitizeUsage(undefined)).toEqual({});
    expect(sanitizeUsage(null)).toEqual({});
    expect(sanitizeUsage("timestamp")).toEqual({});
    expect(sanitizeUsage(["timestamp"])).toEqual({});
  });

  it("drops timestamps older than the window", () => {
    const inWindow = NOW - DAY;
    const outOfWindow = NOW - (USAGE_WINDOW_MS + DAY);
    expect(sanitizeUsage({ timestamp: [outOfWindow, inWindow] }, NOW)).toEqual({
      timestamp: [inWindow],
    });
  });

  it("drops a tool entirely once every timestamp ages out", () => {
    expect(sanitizeUsage({ timestamp: [NOW - USAGE_WINDOW_MS - 1] }, NOW)).toEqual({});
  });

  it("ignores an id whose value is not an array, and non-numeric or future entries", () => {
    expect(
      sanitizeUsage({ timestamp: "not-an-array", jwt: [NOW - DAY, "nope", NOW + DAY] }, NOW),
    ).toEqual({ jwt: [NOW - DAY] });
  });
});

describe("recordUse", () => {
  it("adds a use to a tool with no prior record", () => {
    expect(recordUse({}, "timestamp", NOW)).toEqual({ timestamp: [NOW] });
  });

  it("appends to a tool's existing uses", () => {
    const usage = { timestamp: [NOW - DAY] };
    expect(recordUse(usage, "timestamp", NOW)).toEqual({ timestamp: [NOW - DAY, NOW] });
  });

  it("prunes stale uses of other tools while recording a new one", () => {
    const usage = { jwt: [NOW - USAGE_WINDOW_MS - 1] };
    expect(recordUse(usage, "timestamp", NOW)).toEqual({ timestamp: [NOW] });
  });
});

describe("clearUse", () => {
  it("drops every recorded open of the given tool", () => {
    const usage = { jwt: [NOW - DAY, NOW], timestamp: [NOW] };
    expect(clearUse(usage, "jwt", NOW)).toEqual({ timestamp: [NOW] });
  });

  it("leaves other tools' uses untouched", () => {
    const usage = { jwt: [NOW], timestamp: [NOW - DAY] };
    expect(clearUse(usage, "regex", NOW)).toEqual(usage);
  });

  it("does nothing for a tool with no recorded uses", () => {
    expect(clearUse({}, "jwt", NOW)).toEqual({});
  });
});

describe("rankFrequentTools", () => {
  it("ranks by use count within the window, most used first", () => {
    const usage = {
      jwt: [NOW - DAY],
      timestamp: [NOW - DAY, NOW - 2 * DAY, NOW - 3 * DAY],
      regex: [NOW - DAY, NOW - 2 * DAY],
    };
    expect(rankFrequentTools(usage, 5, NOW)).toEqual(["timestamp", "regex", "jwt"]);
  });

  it("breaks a tie on count by the more recently used tool", () => {
    const usage = {
      jwt: [NOW - 5 * DAY],
      timestamp: [NOW - DAY],
    };
    expect(rankFrequentTools(usage, 5, NOW)).toEqual(["timestamp", "jwt"]);
  });

  it("caps the result at the given limit", () => {
    const usage = { a: [NOW], b: [NOW], c: [NOW], d: [NOW] };
    expect(rankFrequentTools(usage, 2, NOW)).toHaveLength(2);
  });

  it("leaves out a tool whose only uses have aged out of the window", () => {
    const usage = { jwt: [NOW - USAGE_WINDOW_MS - 1], timestamp: [NOW] };
    expect(rankFrequentTools(usage, 5, NOW)).toEqual(["timestamp"]);
  });
});

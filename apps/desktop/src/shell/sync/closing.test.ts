import { describe, expect, it } from "vitest";
import { closingSoon, daysUntil, NEAR_DAYS } from "./closing";

const DAY = 86_400;
const now = Date.UTC(2026, 8, 22, 12);
const inDays = (days: number) => Math.floor(now / 1000) + days * DAY;

describe("a closing date", () => {
  it("is counted in whole days, rounding up — a date later today is today", () => {
    expect(daysUntil(inDays(10), now)).toBe(10);
    expect(daysUntil(inDays(0.5), now)).toBe(1);
    expect(daysUntil(inDays(-1), now)).toBe(-1);
  });

  it("is near within thirty days, and far beyond them", () => {
    expect(NEAR_DAYS).toBe(30);
    expect(closingSoon(inDays(30), now)).toBe(true);
    expect(closingSoon(inDays(31), now)).toBe(false);
  });

  it("stays near once it has passed — the date is advisory and nothing stops on it", () => {
    expect(closingSoon(inDays(-3), now)).toBe(true);
  });

  it("is nothing when there is none", () => {
    expect(closingSoon(null, now)).toBe(false);
  });
});

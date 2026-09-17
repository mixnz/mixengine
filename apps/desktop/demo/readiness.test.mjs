import { describe, expect, it } from "vitest";
import { createQuietDetector } from "./readiness.mjs";

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("createQuietDetector", () => {
  it("is not ready on the first look, however quiet", () => {
    const c = clock();
    const isQuiet = createQuietDetector({ now: c.now });
    expect(isQuiet({ inFlight: 0, calls: 3, mutations: 10 })).toBe(false);
  });

  it("is ready once IPC has been still for 800 ms and the DOM for 500 ms", () => {
    const c = clock();
    const isQuiet = createQuietDetector({ now: c.now });
    isQuiet({ inFlight: 0, calls: 3, mutations: 10 });
    c.advance(799);
    expect(isQuiet({ inFlight: 0, calls: 3, mutations: 10 })).toBe(false);
    c.advance(1);
    expect(isQuiet({ inFlight: 0, calls: 3, mutations: 10 })).toBe(true);
  });

  it("starts over when a call starts, and never counts while one is in flight", () => {
    const c = clock();
    const isQuiet = createQuietDetector({ now: c.now });
    isQuiet({ inFlight: 0, calls: 3, mutations: 10 });
    c.advance(700);
    isQuiet({ inFlight: 0, calls: 4, mutations: 10 });
    c.advance(700);
    expect(isQuiet({ inFlight: 0, calls: 4, mutations: 10 })).toBe(false);
    c.advance(2000);
    expect(isQuiet({ inFlight: 1, calls: 4, mutations: 10 })).toBe(false);
  });

  it("counts nothing until the app has mounted, however long the page was quiet before it", () => {
    const c = clock();
    const isQuiet = createQuietDetector({ now: c.now });
    isQuiet({ inFlight: 0, calls: 0, mutations: 0, mounted: false });
    c.advance(5000);
    expect(isQuiet({ inFlight: 0, calls: 0, mutations: 0, mounted: false })).toBe(false);
    expect(isQuiet({ inFlight: 0, calls: 0, mutations: 0, mounted: true })).toBe(false);
    c.advance(800);
    expect(isQuiet({ inFlight: 0, calls: 0, mutations: 0, mounted: true })).toBe(true);
  });

  it("waits for the DOM separately", () => {
    const c = clock();
    const isQuiet = createQuietDetector({ now: c.now });
    isQuiet({ inFlight: 0, calls: 3, mutations: 10 });
    c.advance(600);
    isQuiet({ inFlight: 0, calls: 3, mutations: 11 });
    c.advance(300);
    expect(isQuiet({ inFlight: 0, calls: 3, mutations: 11 })).toBe(false);
    c.advance(200);
    expect(isQuiet({ inFlight: 0, calls: 3, mutations: 11 })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { segmentsFor } from "./metricsHistoryState";

const minute = (at: number, cpuAvg: number | null = 1): {
  subject: string;
  minute: number;
  cpu_avg: number | null;
  cpu_peak: number | null;
  rss_avg: number;
  rss_peak: number;
  samples: number;
} => ({
  subject: "daemon",
  minute: at,
  cpu_avg: cpuAvg,
  cpu_peak: cpuAvg,
  rss_avg: 0,
  rss_peak: 0,
  samples: 1,
});

describe("segmentsFor", () => {
  it("keeps contiguous minutes in one segment", () => {
    const minutes = [minute(0), minute(60_000), minute(120_000)];
    expect(segmentsFor(minutes)).toEqual([minutes]);
  });

  /* Một phút vắng (ở đây: 60_000 -> 180_000, thiếu 120_000) là ranh giới đoạn — không một đường
     nối hai đoạn qua nó. */
  it("breaks into a new segment across a missing minute", () => {
    const first = minute(0);
    const second = minute(60_000);
    const third = minute(180_000);
    expect(segmentsFor([first, second, third])).toEqual([[first, second], [third]]);
  });

  it("is empty for no data", () => {
    expect(segmentsFor([])).toEqual([]);
  });

  it("puts a single reading in its own segment", () => {
    const only = minute(0);
    expect(segmentsFor([only])).toEqual([[only]]);
  });
});

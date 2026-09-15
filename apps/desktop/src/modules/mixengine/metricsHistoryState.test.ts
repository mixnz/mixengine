import { describe, expect, it } from "vitest";

import { gapsIn, nearestMinute, runsOf, sampledRanges, segmentsFor } from "./metricsHistoryState";

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

const hasCpu = (m: { cpu_avg: number | null }) => m.cpu_avg !== null;

describe("runsOf", () => {
  it("keeps a fully measured segment in one run", () => {
    const segment = [minute(0), minute(60_000)];
    expect(runsOf(segment, hasCpu)).toEqual([segment]);
  });

  /* `cpu_avg: null` là một phút không lần đọc nào mang được con số CPU. Lọc nó ra rồi nối hai bên
     lại là bịa ra một đoạn chưa từng đo — cùng một lỗi như nối qua một phút vắng. */
  it("breaks a run where the value is missing", () => {
    const first = minute(0);
    const absent = minute(60_000, null);
    const third = minute(120_000);
    expect(runsOf([first, absent, third], hasCpu)).toEqual([[first], [third]]);
  });

  it("drops a segment nobody measured", () => {
    expect(runsOf([minute(0, null)], hasCpu)).toEqual([]);
  });
});

describe("gapsIn", () => {
  /* Một đoạn phủ từ phút đầu tới hết phút cuối — phút `n` là khoảng [n, n+60s). */
  it("finds the window either side of one segment", () => {
    const segments = [[minute(600_000), minute(660_000)]];
    expect(gapsIn(segments, 0, 900_000)).toEqual([
      { from: 0, to: 600_000 },
      { from: 720_000, to: 900_000 },
    ]);
  });

  it("finds the hole between two segments", () => {
    const segments = [[minute(0)], [minute(180_000)]];
    expect(gapsIn(segments, 0, 240_000)).toEqual([{ from: 60_000, to: 180_000 }]);
  });

  it("calls the whole window a gap when nothing was measured", () => {
    expect(gapsIn([], 0, 3_600_000)).toEqual([{ from: 0, to: 3_600_000 }]);
  });

  it("finds no gap in a fully covered window", () => {
    expect(gapsIn([[minute(0), minute(60_000)]], 0, 120_000)).toEqual([]);
  });
});

const watched = (at: number, samples: number) => ({ ...minute(at), samples });

describe("sampledRanges", () => {
  /* `samples: 1` là một phút không ai nhìn: `cpu_peak` bằng `cpu_avg` vì chỉ có đúng một lần đọc,
     nên dải đỉnh dẹt xuống thành không. Dẹt vì không ai đo khác hẳn dẹt vì thật sự đều — và đây là
     thứ nói ra sự khác nhau đó. */
  it("finds the stretch somebody was watching", () => {
    const segment = [watched(0, 60), watched(60_000, 42)];
    expect(sampledRanges([segment], 2)).toEqual([{ from: 0, to: 120_000 }]);
  });

  it("breaks the stretch at a minute of one reading", () => {
    const segment = [watched(0, 60), watched(60_000, 1), watched(120_000, 60)];
    expect(sampledRanges([segment], 2)).toEqual([
      { from: 0, to: 60_000 },
      { from: 120_000, to: 180_000 },
    ]);
  });

  it("finds nothing where nobody was watching", () => {
    expect(sampledRanges([[watched(0, 1), watched(60_000, 1)]], 2)).toEqual([]);
  });

  /* Hai đoạn là hai đoạn: giữa chúng là một phút vắng, không phải một lúc ai đó vẫn đang nhìn. */
  it("never joins two segments into one stretch", () => {
    const segments = [[watched(0, 60)], [watched(180_000, 60)]];
    expect(sampledRanges(segments, 2)).toEqual([
      { from: 0, to: 60_000 },
      { from: 180_000, to: 240_000 },
    ]);
  });
});

describe("nearestMinute", () => {
  const minutes = [minute(0), minute(60_000), minute(120_000)];

  it("finds the closest minute either side of the pointer", () => {
    expect(nearestMinute(minutes, 61_000, 30_000)?.minute).toBe(60_000);
    expect(nearestMinute(minutes, 100_000, 30_000)?.minute).toBe(120_000);
  });

  /* Trong vùng chưa có dữ liệu, phút gần nhất có thể cách hàng giờ — đọc nó ra là nói dối. */
  it("finds nothing past the tolerance", () => {
    expect(nearestMinute(minutes, 600_000, 30_000)).toBeNull();
  });

  it("finds nothing in an empty history", () => {
    expect(nearestMinute([], 0, 30_000)).toBeNull();
  });
});

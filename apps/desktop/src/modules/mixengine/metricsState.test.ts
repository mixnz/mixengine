import { describe, expect, it } from "vitest";

import {
  DAEMON_SUBJECT,
  formatBytes,
  formatPercent,
  metricsSubjectFor,
  parseMetricsFrame,
  readingFor,
} from "./metricsState";

describe("metricsSubjectFor", () => {
  it("prefixes a service id with service:, since the prefix is load-bearing", () => {
    expect(metricsSubjectFor("mariadb@main")).toBe("service:mariadb@main");
  });

  /* Một service tên "daemon" là hợp lệ phía MixEngine (ServiceId::parse chấp nhận tên trần) — nếu
     không giữ prefix, nó sẽ trùng DAEMON_SUBJECT và ăn nhầm lịch sử của daemon. */
  it("does not collide with the daemon subject for a service literally named daemon", () => {
    expect(metricsSubjectFor("daemon")).not.toBe(DAEMON_SUBJECT);
    expect(metricsSubjectFor("daemon")).toBe("service:daemon");
  });
});

describe("parseMetricsFrame", () => {
  it("parses a well-formed frame", () => {
    const raw = JSON.stringify({ at: 1757203200000, samples: [] });
    expect(parseMetricsFrame(raw)).toEqual({ at: 1757203200000, samples: [] });
  });

  it("returns null for something that is not even JSON", () => {
    expect(parseMetricsFrame("<html>")).toBeNull();
  });

  it("returns null for JSON missing the fields a frame must have", () => {
    expect(parseMetricsFrame(JSON.stringify({ whatever: 1 }))).toBeNull();
  });
});

describe("readingFor", () => {
  const frame = {
    at: 1757203200000,
    samples: [
      { subject: "daemon", cpu_percent: 1, rss_bytes: 100, processes: 1 },
      { subject: "service:mariadb@main", cpu_percent: null, rss_bytes: 200, processes: 2 },
    ],
  };

  it("finds the sample for a subject present in the frame", () => {
    expect(readingFor(frame, "service:mariadb@main")?.rss_bytes).toBe(200);
  });

  /* Vắng mặt trong frame không phải là 0 — một subject không đo được thì không nằm trong samples,
     không phải một sample với các số 0. */
  it("is null for a subject absent from the frame, not a zeroed sample", () => {
    expect(readingFor(frame, "service:caddy@main")).toBeNull();
  });

  it("is null when there is no frame yet", () => {
    expect(readingFor(null, "daemon")).toBeNull();
  });

  /* cpu_percent: null trong một sample đã có mặt phải giữ nguyên null qua readingFor — không phải
     lỗi parse, là câu trả lời thật của lần đo đầu tiên chưa có gì để trừ. */
  it("keeps a present sample's null cpu_percent as null, not coerced to zero", () => {
    expect(readingFor(frame, "service:mariadb@main")?.cpu_percent).toBeNull();
  });
});

describe("formatBytes", () => {
  it("rounds to one decimal and drops it when it would be a zero", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
  });
});

describe("formatPercent", () => {
  it("always shows exactly four decimal digits", () => {
    expect(formatPercent(0)).toBe("0.0000%");
    expect(formatPercent(1.5)).toBe("1.5000%");
    expect(formatPercent(2.123456)).toBe("2.1235%");
  });

  /* 250 là hai lõi rưỡi (MetricsSample.cpu_percent doc-comment) — vẫn giữ nguyên bốn chữ số thập
     phân, không cắt về số nguyên chỉ vì giá trị lớn hơn 100. */
  it("keeps the format for a reading over one core", () => {
    expect(formatPercent(250)).toBe("250.0000%");
  });
});

import { describe, expect, it } from "vitest";
import { fileName, formatBytes, hexDump, prettyJson, shortUrl } from "./format";

describe("formatBytes", () => {
  it("counts small bodies in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("drops a trailing zero rather than showing 1.0 KB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("keeps one decimal where it says something", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("climbs through the units", () => {
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
  });
});

describe("hexDump", () => {
  it("has nothing to say about no bytes", () => {
    expect(hexDump(new Uint8Array(), 100)).toBe("");
  });

  it("writes the offset, the bytes and the readable characters", () => {
    const line = hexDump(new TextEncoder().encode("Hi"), 100);
    expect(line.startsWith("00000000  48 69")).toBe(true);
    expect(line.endsWith("  Hi")).toBe(true);
  });

  it("puts sixteen bytes on a line", () => {
    const dump = hexDump(new Uint8Array(20), 100);
    expect(dump.split("\n")).toHaveLength(2);
    expect(dump.split("\n")[1].startsWith("00000010")).toBe(true);
  });

  it("stands a dot in for anything unprintable", () => {
    expect(hexDump(new Uint8Array([0x00, 0x41]), 100).endsWith("  .A")).toBe(true);
  });

  it("stops at the cap", () => {
    expect(hexDump(new Uint8Array(64), 16).split("\n")).toHaveLength(1);
  });
});

describe("prettyJson", () => {
  it("lays JSON out over lines", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  // The Preview tab shows what came back. Text that is not JSON is still what came back.
  it("hands back anything it cannot parse, untouched", () => {
    expect(prettyJson("not json")).toBe("not json");
  });
});

describe("shortUrl", () => {
  it("drops the scheme and the query, which is what a sidebar row has no room for", () => {
    expect(shortUrl("https://api.example.test/v1/users?page=2")).toBe("api.example.test/v1/users");
  });

  it("keeps a scheme that is not http, since dropping it would mislead", () => {
    expect(shortUrl("ftp://x.test/a")).toBe("ftp://x.test/a");
  });

  it("drops a trailing slash", () => {
    expect(shortUrl("https://x.test/")).toBe("x.test");
  });

  it("has nothing to shorten in an empty URL", () => {
    expect(shortUrl("")).toBe("");
  });
});

describe("fileName", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(fileName("/home/ann/photos/a.png")).toBe("a.png");
  });

  it("takes the last segment of a Windows path", () => {
    expect(fileName("C:\\Users\\ann\\a.png")).toBe("a.png");
  });

  it("ignores a trailing separator", () => {
    expect(fileName("/home/ann/photos/")).toBe("photos");
  });

  it("gives back a bare name unchanged", () => {
    expect(fileName("a.png")).toBe("a.png");
  });

  it("gives back an empty path as it is", () => {
    expect(fileName("")).toBe("");
  });
});

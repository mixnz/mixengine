import { describe, expect, it } from "vitest";
import { sourceBucket } from "./ratelimit";

describe("what a request is counted under", () => {
  it("is an IPv6 address's /64, however the address is written", () => {
    // One subscriber holds a whole /64 and can use a fresh address for every request; keyed by
    // the full address, every per-source counter started from zero each time.
    expect(sourceBucket("2001:db8:1:2:aaaa::1")).toBe(sourceBucket("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(sourceBucket("2001:DB8:0001:0002::1")).toBe(sourceBucket("2001:db8:1:2::9"));
    expect(sourceBucket("2001:db8::1")).toBe(sourceBucket("2001:db8:0:0:1::"));
    expect(sourceBucket("2001:db8:1:2::1")).not.toBe(sourceBucket("2001:db8:1:3::1"));
  });

  it("is an IPv4 address alone, however it is written", () => {
    expect(sourceBucket("192.0.2.1")).not.toBe(sourceBucket("192.0.2.2"));
    expect(sourceBucket("::ffff:192.0.2.1")).toBe(sourceBucket("192.0.2.1"));
  });

  it("keeps anything else as a bucket of its own", () => {
    expect(sourceBucket("local")).toBe("local");
  });
});

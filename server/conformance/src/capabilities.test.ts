import { describe, expect, it } from "vitest";
import { call, type Capabilities } from "./client.js";

const LIMITS = [
  "maxRecordBytes",
  "maxBatchOperations",
  "maxPageRecords",
  "accountQuotaBytes",
  "tombstoneRetentionDays",
] as const;

describe("GET /v1/capabilities", () => {
  it("answers without an account, and says it speaks v1", async () => {
    const result = await call<Capabilities>("/v1/capabilities");
    expect(result.status).toBe(200);
    expect(result.body.protocolVersions).toContain("v1");
  });

  it.each(LIMITS)("reports %s as a positive whole number", async (limit) => {
    const result = await call<Capabilities>("/v1/capabilities");
    const value = result.body[limit];
    expect(Number.isSafeInteger(value)).toBe(true);
    // `tombstoneRetentionDays` may legitimately be 0 on a server configured to reap at once, which
    // is how the cursor-expiry test below becomes reachable at all.
    expect(value).toBeGreaterThanOrEqual(limit === "tombstoneRetentionDays" ? 0 : 1);
  });

  it("reports a feature list, so a client can run against an empty one forever", async () => {
    const result = await call<Capabilities>("/v1/capabilities");
    expect(Array.isArray(result.body.features)).toBe(true);
  });

  it("is cacheable, because it is read before every sync and changes almost never", async () => {
    const result = await call("/v1/capabilities");
    expect(result.headers.get("cache-control") ?? "").toMatch(/max-age=\d+/);
  });

  it("ignores an Authorization header rather than refusing one", async () => {
    // A client reads this route before it has an account, and may still be holding a token that
    // expired weeks ago. Neither is a reason to withhold the limits.
    const result = await call<Capabilities>("/v1/capabilities", { token: "not-a-token" });
    expect(result.status).toBe(200);
    expect(result.body.protocolVersions).toContain("v1");
  });
});

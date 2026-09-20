import { describe, expect, it } from "vitest";
import { base64Bytes, call, type Capabilities, newRecord, opaqueId, put, signedUp } from "./client.js";

// Filling a 20 MB account over HTTP is minutes of runner time for one assertion. The suite fills
// an account only when the server under test reports a small quota, and says so loudly otherwise —
// a skipped test that announces itself is honest; a quota test that quietly passes is not.
const FILLABLE_BYTES = 8 * 1024 * 1024;

describe("the per-account quota", () => {
  it("refuses a write past the limit it reported, and says where the account stands", async ({ skip }) => {
    const limits = (await call<Capabilities>("/v1/capabilities")).body;
    if (limits.accountQuotaBytes > FILLABLE_BYTES) {
      skip(
        `this server reports accountQuotaBytes=${limits.accountQuotaBytes}; filling it would take ` +
          "minutes. Configure a smaller quota on the instance under test to cover this.",
      );
    }

    const { session } = await signedUp();
    const collection = opaqueId();
    const chunk = Math.min(256 * 1024, Math.floor(limits.accountQuotaBytes / 4));

    let refusal: Awaited<ReturnType<typeof put>> | undefined;
    for (let written = 0; written <= limits.accountQuotaBytes + chunk; written += chunk) {
      const result = await put(
        session.accessToken,
        collection,
        opaqueId(),
        { ...newRecord(), ciphertext: base64Bytes(chunk) },
        { ifNoneMatch: true },
      );
      if (result.status !== 201) {
        refusal = result;
        break;
      }
    }

    expect(refusal, "the account never filled up").toBeDefined();
    expect(refusal?.status).toBe(507);
    expect(refusal?.body.error?.code).toBe("quota-exceeded");
    // The client has to tell a person what to delete, so the numbers travel with the refusal.
    expect(refusal?.body.error?.["limit"]).toBe(limits.accountQuotaBytes);
    expect(refusal?.body.error?.["used"]).toBeTypeOf("number");
  });

  it("keeps a fresh account well clear of the limit", async () => {
    const limits = (await call<Capabilities>("/v1/capabilities")).body;
    const { session } = await signedUp();
    const result = await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });

    expect(result.status).toBe(201);
    expect(limits.accountQuotaBytes).toBeGreaterThan(0);
  });
});

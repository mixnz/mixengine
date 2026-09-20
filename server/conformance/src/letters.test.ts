import { describe, expect, it } from "vitest";
import {
  call,
  type ErrorBody,
  newAccount,
  newEmail,
  outbox,
  register,
  registerBody,
  signedUp,
} from "./client.js";

// A letter is counted against the address it reaches, not only against the network that asked for
// it (D4a). Counting per source bounds what one network can send and bounds nothing about what one
// mailbox receives — and a mailbox is a fixed target.

/** More than any sane allowance, so the cap is reached whatever the server was configured with. */
const MANY = 12;

describe("asking for reset letters over and over", () => {
  it("stops sending them, and never says which addresses exist", async () => {
    const { account } = await signedUp();

    for (let asked = 0; asked < MANY; asked += 1) {
      const result = await call<ErrorBody>("/v1/auth/reset", { body: { email: account.email } });
      // **Always 202.** This route answers alike for an address that has an account and one that
      // does not, so a refusal only a throttled address could meet would tell them apart.
      expect(result.status).toBe(202);
    }

    const letters = (await outbox(account.email)).filter((message) => message.kind === "reset");
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.length).toBeLessThan(MANY);
  });

  it("says nothing different about an address with no account", async () => {
    const stranger = newEmail();
    for (let asked = 0; asked < MANY; asked += 1) {
      const result = await call("/v1/auth/reset", { body: { email: stranger } });
      expect(result.status).toBe(202);
    }
  });
});

describe("registering over an unverified account over and over", () => {
  it("stops, because each one sends a fresh letter to the same address", async () => {
    // Registering over an unverified account replaces it and sends another letter, so without a
    // cap this is a mail flood aimed at whoever owns the address.
    const email = newEmail();
    let refused: number | null = null;

    for (let attempt = 0; attempt < MANY; attempt += 1) {
      const result = await call<ErrorBody>("/v1/auth/register", {
        body: registerBody(newAccount({ email })),
      });
      if (result.status === 429) {
        refused = attempt;
        expect(result.body.error.code).toMatch(/^too-many-/);
        break;
      }
      expect(result.status).toBe(201);
    }

    // Small, and reached long before MANY. The outbox is not consulted here: registering over an
    // unverified account replaces it, and the letters it already held go with it — which is the
    // same replacement that makes an allowance kept inside the account worthless (D4a).
    expect(refused).not.toBeNull();
    expect(refused as number).toBeGreaterThan(0);
  });

  it("does not let one address lock another out", async () => {
    // The counter is per address. A server keeping one bucket for all letters would let anybody
    // stop everybody else from registering.
    const noisy = newEmail();
    for (let attempt = 0; attempt < MANY; attempt += 1) {
      await call("/v1/auth/register", { body: registerBody(newAccount({ email: noisy })) });
    }

    const innocent = await register(newAccount());
    expect(innocent.status).toBe(201);
  });
});

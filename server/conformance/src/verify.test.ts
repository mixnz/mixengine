import { describe, expect, it } from "vitest";
import { baseUrl, call, type ErrorBody, latestToken, newAccount, outbox, register } from "./client.js";

describe("verifying an address", () => {
  it("sends exactly one verification message when an account is made", async () => {
    const account = newAccount();
    await register(account);
    const messages = await outbox(account.email);
    expect(messages.filter((message) => message.kind === "verification")).toHaveLength(1);
  });

  it("completes with the token that was sent", async () => {
    const account = newAccount();
    await register(account);
    const token = await latestToken(account.email, "verification");

    const result = await call("/v1/auth/verify", { body: { email: account.email, token } });
    expect(result.status).toBe(200);
  });

  it("refuses a token that is not the one, without saying which way it is wrong", async () => {
    const account = newAccount();
    await register(account);

    const result = await call<ErrorBody>("/v1/auth/verify", {
      body: { email: account.email, token: "definitely-not-the-token" },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-token");
  });

  it("refuses the same token a second time, with the same code as a wrong one", async () => {
    // Wrong, expired and already-used answer alike on purpose: telling them apart is an oracle,
    // and the remedy a person needs is the same sentence in all three cases (D4a).
    const account = newAccount();
    await register(account);
    const token = await latestToken(account.email, "verification");
    await call("/v1/auth/verify", { body: { email: account.email, token } });

    const replay = await call<ErrorBody>("/v1/auth/verify", { body: { email: account.email, token } });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("invalid-token");
  });

  it("sends a code a person can type, not a link", async () => {
    // A link would need the server to know the address it is reachable at — a setting that is
    // wrong silently until somebody clicks one — and mail scanners fetch every URL in a message.
    // This is a desktop application: the person is already in front of the window (D4a).
    const account = newAccount();
    await register(account);
    const code = await latestToken(account.email, "verification");

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(code).not.toContain("http");
  });

  it("accepts the code however it was typed", async () => {
    // Forgiving about case and separators, which is how a person retypes something read off a
    // screen — the rule the recovery key already follows, so there is one way to type a code.
    const account = newAccount();
    await register(account);
    const code = await latestToken(account.email, "verification");

    const retyped = code.toLowerCase().replace("-", " ");
    const result = await call("/v1/auth/verify", { body: { email: account.email, token: retyped } });
    expect(result.status).toBe(200);
  });

  it("refuses a character the alphabet does not have", async () => {
    // Strict about the alphabet: `I`, `L`, `O` and `U` are not in it, so a code containing one
    // means the person has the wrong thing in front of them and should be told so.
    const account = newAccount();
    await register(account);

    const result = await call<ErrorBody>("/v1/auth/verify", {
      body: { email: account.email, token: "IIII-IIII" },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-token");
  });

  it("stops somebody guessing at eight characters", async () => {
    // **The one allowance this suite deliberately exhausts.** Forty bits typed by a person is
    // only safe because guessing is bounded, so the bound is part of the protocol rather than a
    // deployment detail, and a server without it would pass everything else here (D4a).
    const account = newAccount();
    await register(account);

    let refusal: Awaited<ReturnType<typeof call<ErrorBody>>> | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await call<ErrorBody>("/v1/auth/verify", {
        body: { email: account.email, token: "ZZZZ-ZZZZ" },
      });
      if (result.status === 429) {
        refusal = result;
        break;
      }
      expect(result.status).toBe(400);
    }

    expect(refusal, "a wrong code could be tried forty times").toBeDefined();
    expect(refusal?.body.error.code).toBe("too-many-requests");
    expect(Number(refusal?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses to sign in until the address is verified", async () => {
    // Verification is the gate on signing in, not on writing: in v1 no token exists that could
    // reach a record route with `verified` false, so this refusal is where D4's "no record may be
    // written before this" is actually enforced (D4a).
    const account = newAccount();
    await register(account);

    const result = await call<ErrorBody>("/v1/auth/login", {
      body: { email: account.email, a: account.a, deviceName: "conformance" },
    });
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe("email-not-verified");
  });
});

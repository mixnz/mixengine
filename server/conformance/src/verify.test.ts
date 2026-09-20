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

  it("serves the emailed link as a page, and does not spend the token doing it", async () => {
    // Mail scanners and link previewers fetch every URL in a message. A GET that verified would be
    // spent before the person read the letter, and the bug would read as "the link never works".
    const account = newAccount();
    await register(account);
    const token = await latestToken(account.email, "verification");

    const query = new URLSearchParams({ email: account.email, token });
    const page = await fetch(`${baseUrl()}/v1/auth/verify?${query}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type") ?? "").toContain("text/html");

    const completed = await call("/v1/auth/verify", { body: { email: account.email, token } });
    expect(completed.status).toBe(200);
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

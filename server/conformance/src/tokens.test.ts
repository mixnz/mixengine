import { describe, expect, it } from "vitest";
import { call, type ErrorBody, type Session, signedUp } from "./client.js";

const refresh = (refreshToken: string) =>
  call<Session & Partial<ErrorBody>>("/v1/auth/refresh", { body: { refreshToken } });

describe("tokens", () => {
  it("exchanges a refresh token for a new pair", async () => {
    const { session } = await signedUp();
    const result = await refresh(session.refreshToken);

    expect(result.status).toBe(200);
    expect(result.body.accessToken).toBeTypeOf("string");
    expect(result.body.refreshToken).toBeTypeOf("string");
    expect(result.body.refreshToken).not.toBe(session.refreshToken);
  });

  it("kills the old refresh token as it rotates", async () => {
    const { session } = await signedUp();
    await refresh(session.refreshToken);

    const again = await refresh(session.refreshToken);
    expect(again.status).toBe(401);
    expect(again.body.error?.code).toBe("invalid-token");
  });

  it("revokes the whole chain when a rotated token comes back", async () => {
    // Either it was copied, or two clients raced. Both want the person to sign in again rather
    // than continue quietly, and this is the one signal the design gets for free that a token has
    // been stolen (D4a).
    const { session } = await signedUp();
    const rotated = await refresh(session.refreshToken);
    expect(rotated.status).toBe(200);

    await refresh(session.refreshToken); // the reuse
    const successor = await refresh(rotated.body.refreshToken);
    expect(successor.status).toBe(401);
    expect(successor.body.error?.code).toBe("invalid-token");
  });

  it("gives an access token the short life it is supposed to have", async () => {
    const { session } = await signedUp();
    // A ceiling, not a value: the number is configuration, and this asserts only that it is short
    // enough for the device-revocation window described in D4a to mean anything.
    expect(session.expiresIn).toBeLessThanOrEqual(3600);
  });

  it.each([
    ["nothing", undefined],
    ["a string that is not a token", "not-a-token"],
  ])("refuses a record listing presented with %s", async (_label, token) => {
    const result = await call<ErrorBody>("/v1/records?since=0", token ? { token } : {});
    expect(result.status).toBe(401);
  });

  it("refuses a refresh token presented as an access token", async () => {
    const { session } = await signedUp();
    const result = await call<ErrorBody>("/v1/records?since=0", { token: session.refreshToken });
    expect(result.status).toBe(401);
  });
});

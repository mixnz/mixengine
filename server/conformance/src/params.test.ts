import { describe, expect, it } from "vitest";
import {
  ARGON,
  base64Bytes,
  call,
  type ErrorBody,
  newAccount,
  newEmail,
  register,
  type Session,
  signedUp,
} from "./client.js";

interface Params {
  saltAccount: string;
  argon: { m: number; t: number; p: number };
}

const params = (email: string) =>
  call<Params & Partial<ErrorBody>>(`/v1/auth/params?email=${encodeURIComponent(email)}`);

/** Sixteen bytes, which is 24 characters of base64 with one pad. */
const SALT = /^[A-Za-z0-9+/]{22}==$/;

describe("GET /v1/auth/params", () => {
  it("hands back what a second machine needs before it can compute anything", async () => {
    // Without this route a fresh install has the password and the address and nothing else, and
    // `A` is unreachable — which would put the whole milestone out of reach (D4a).
    const account = newAccount();
    await register(account);

    const result = await params(account.email);
    expect(result.status).toBe(200);
    expect(result.body.saltAccount).toBe(account.saltAccount);
    expect(result.body.argon).toEqual(ARGON);
  });

  it("needs no account of its own to answer", async () => {
    // A client reads this before it has a token, and may still be holding one that expired.
    const account = newAccount();
    await register(account);
    const result = await call<Params>(
      `/v1/auth/params?email=${encodeURIComponent(account.email)}`,
      { token: "not-a-token" },
    );
    expect(result.status).toBe(200);
    expect(result.body.saltAccount).toBe(account.saltAccount);
  });

  it("answers for an address that has no account at all", async () => {
    const result = await params(newEmail());
    expect(result.status).toBe(200);
    expect(result.body.saltAccount).toMatch(SALT);
    expect(result.body.argon.m).toBeGreaterThan(0);
  });

  it("invents the same salt every time it is asked", async () => {
    // A value that changed between two probes would announce itself as invented, and the route
    // would become the cheapest account-enumeration oracle in the protocol (D4a).
    const stranger = newEmail();
    const first = await params(stranger);
    const second = await params(stranger);
    expect(second.body.saltAccount).toBe(first.body.saltAccount);
  });

  it("invents a different salt for a different address", async () => {
    const one = await params(newEmail());
    const other = await params(newEmail());
    expect(other.body.saltAccount).not.toBe(one.body.saltAccount);
  });

  it("invents one that cannot be told from a real one by looking at it", async () => {
    const account = newAccount();
    await register(account);

    const real = await params(account.email);
    const invented = await params(newEmail());

    expect(invented.body.saltAccount).toMatch(SALT);
    expect(invented.body.saltAccount.length).toBe(real.body.saltAccount.length);
    expect(Object.keys(invented.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(invented.body.argon).toEqual(real.body.argon);
  });

  it.each([
    ["saltAccount", 16],
    ["a", 32],
    ["wrappedMkPassword", 72],
    ["wrappedMkRecovery", 72],
  ])("refuses a %s that is not %i bytes", async (member, bytes) => {
    // Every one of these has a length the design already fixed, and the account row is the one
    // thing the per-account quota does not count — so without a bound, registration takes as many
    // bytes as anybody sends and keeps them for ever (D4a).
    for (const wrong of [bytes - 1, bytes + 1]) {
      const result = await call<ErrorBody>("/v1/auth/register", {
        body: { ...newAccount(), argon: ARGON, [member]: base64Bytes(wrong) },
      });
      expect(result.status, `${member} at ${wrong} bytes`).toBe(400);
      expect(result.body.error.code).toBe("invalid-request");
    }
  });

  it("refuses a request that names no address", async () => {
    const result = await call<ErrorBody>("/v1/auth/params");
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-email");
  });
});

describe("signing in", () => {
  it("hands back both wrapped copies of the master key", async () => {
    // The other half of what a second machine needs: without them it has an account it cannot
    // read, because MK lives nowhere else. After the verifier matched, and nowhere else (D4a).
    const verified = await signedUp();
    const result = await call<Session & { wrappedMkPassword: string; wrappedMkRecovery: string }>(
      "/v1/auth/login",
      {
        body: {
          email: verified.account.email,
          a: verified.account.a,
          deviceName: "second-machine",
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.wrappedMkPassword).toBe(verified.account.wrappedMkPassword);
    expect(result.body.wrappedMkRecovery).toBe(verified.account.wrappedMkRecovery);
  });

  it("does not hand them to a wrong password", async () => {
    const { account } = await signedUp();
    const result = await call<ErrorBody & { wrappedMkPassword?: string }>("/v1/auth/login", {
      body: { email: account.email, a: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", deviceName: "x" },
    });

    expect(result.status).toBe(401);
    expect(result.body.wrappedMkPassword).toBeUndefined();
  });
});

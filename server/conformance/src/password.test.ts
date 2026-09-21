import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  call,
  type ErrorBody,
  login,
  newAccount,
  register,
  seed,
  type Session,
  signedUp,
  since,
  verify,
} from "./client.js";

describe("POST /v1/auth/password", () => {
  it("takes a new verifier and a newly wrapped key", async () => {
    const { account, session } = await signedUp();
    const next = { a: base64Bytes(32), saltAccount: base64Bytes(16), wrapped: base64Bytes(72) };

    const result = await call("/v1/auth/password", {
      token: session.accessToken,
      body: {
        a: account.a,
        newA: next.a,
        newSaltAccount: next.saltAccount,
        newWrappedMkPassword: next.wrapped,
      },
    });
    expect(result.status).toBe(200);

    const withOld = await call<ErrorBody>("/v1/auth/login", {
      body: { email: account.email, a: account.a, deviceName: "conformance" },
    });
    expect(withOld.status).toBe(401);

    const withNew = await call<Session>("/v1/auth/login", {
      body: { email: account.email, a: next.a, deviceName: "conformance" },
    });
    expect(withNew.status).toBe(200);
  });

  it("refuses to change it without the current verifier", async () => {
    const { session } = await signedUp();
    const result = await call<ErrorBody>("/v1/auth/password", {
      token: session.accessToken,
      body: {
        a: base64Bytes(32),
        newA: base64Bytes(32),
        newSaltAccount: base64Bytes(16),
        newWrappedMkPassword: base64Bytes(72),
      },
    });

    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe("invalid-credentials");
  });

  it("re-wraps without touching a single record", async () => {
    // MK is unchanged, so nothing is re-encrypted and no sequence number moves (D6, case 1). A
    // server that bumped `seq` here would make every other machine re-download the whole account.
    const account = newAccount();
    await register(account);
    await verify(account);
    const session = await login(account);
    const { collection, stored } = await seed(session.accessToken);

    await call("/v1/auth/password", {
      token: session.accessToken,
      body: {
        a: account.a,
        newA: base64Bytes(32),
        newSaltAccount: base64Bytes(16),
        newWrappedMkPassword: base64Bytes(72),
      },
    });

    const page = await since(session.accessToken, 0, collection);
    expect(page.body.records).toHaveLength(1);
    expect(page.body.records[0]?.version).toBe(stored.version);
    expect(page.body.records[0]?.seq).toBe(stored.seq);
    expect(page.body.records[0]?.ciphertext).toBe(stored.ciphertext);
  });

  it("signs the other machines out and leaves this one signed in", async () => {
    const account = newAccount();
    await register(account);
    await verify(account);
    const laptop = await login(account, "laptop");
    const desktop = await login(account, "desktop");

    await call("/v1/auth/password", {
      token: laptop.accessToken,
      body: {
        a: account.a,
        newA: base64Bytes(32),
        newSaltAccount: base64Bytes(16),
        newWrappedMkPassword: base64Bytes(72),
      },
    });

    const theirs = await call<ErrorBody>("/v1/auth/refresh", {
      body: { refreshToken: desktop.refreshToken },
    });
    expect(theirs.status).toBe(401);

    const mine = await call<Session>("/v1/auth/refresh", { body: { refreshToken: laptop.refreshToken } });
    expect(mine.status).toBe(200);
  });
});

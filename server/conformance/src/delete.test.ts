import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  call,
  type ErrorBody,
  login,
  newAccount,
  newRecord,
  opaqueId,
  put,
  register,
  registerBody,
  type Session,
  signedUp,
  since,
  verify,
} from "./client.js";

// Deleting an account takes everything with it, and leaves the server as it was before the account
// existed (D4b). A move is a copy and then one of these; a person who is simply finished makes the
// same call.

interface Deleted {
  recordsDeleted: number;
}

const remove = (token: string, a: string) =>
  call<Deleted & Partial<ErrorBody>>("/v1/account/delete", { method: "POST", token, body: { a } });

describe("deleting an account", () => {
  it("takes every record with it", async () => {
    const { account, session } = await signedUp();
    const collection = opaqueId();
    for (let written = 0; written < 3; written += 1) {
      await put(session.accessToken, collection, opaqueId(), newRecord(), { ifNoneMatch: true });
    }

    const result = await remove(session.accessToken, account.a);
    expect(result.status).toBe(200);
    expect(result.body.recordsDeleted).toBe(3);
  });

  it("signs every machine out, because there is nothing left to be signed in to", async () => {
    const { account, session } = await signedUp();
    const laptop = await login(account, "laptop");

    await remove(session.accessToken, account.a);

    const read = await since(laptop.accessToken, 0);
    expect(read.status).toBe(401);
    expect(read.body.error?.code).toBe("invalid-token");

    const refreshed = await call<Session & Partial<ErrorBody>>("/v1/auth/refresh", {
      body: { refreshToken: laptop.refreshToken },
    });
    expect(refreshed.status).toBe(401);
  });

  it("hands the address straight back", async () => {
    // Nothing is kept — no tombstone, no row saying this address was once here. Keeping one would
    // be keeping the single fact D1 promises a server does not accumulate.
    const { account, session } = await signedUp();
    await remove(session.accessToken, account.a);

    const fresh = newAccount({ email: account.email });
    const again = await register(fresh);
    expect(again.status).toBe(201);
  });

  it("leaves nothing for the next account on that address to find", async () => {
    const { account, session } = await signedUp();
    await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), { ifNoneMatch: true });
    await remove(session.accessToken, account.a);

    const fresh = newAccount({ email: account.email });
    await register(fresh);
    await verify(fresh);
    const after = await login(fresh);

    const page = await since(after.accessToken, 0);
    expect(page.status).toBe(200);
    expect(page.body.records).toHaveLength(0);
  });

  it("does not reuse the sequence numbers either", async () => {
    // A fresh account on a reused address is a fresh account: a machine still holding a cursor
    // from the old one must not be told that nothing has changed.
    const { account, session } = await signedUp();
    await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), { ifNoneMatch: true });
    await remove(session.accessToken, account.a);

    const fresh = newAccount({ email: account.email });
    await register(fresh);
    await verify(fresh);
    const after = await login(fresh);
    const written = await put(after.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });
    expect(written.body.seq).toBeGreaterThan(0);
  });
});

describe("what it takes to delete an account", () => {
  it("is not a session on its own", async () => {
    // A borrowed unlocked machine already holds a valid access token. Asking for `A` means the
    // person deleting the account is the person who knows the password (D4b).
    const { session } = await signedUp();

    const result = await remove(session.accessToken, base64Bytes(32));
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("invalid-credentials");

    // And the account is untouched by the attempt.
    const page = await since(session.accessToken, 0);
    expect(page.status).toBe(200);
  });

  it("is not a password on its own", async () => {
    const { account } = await signedUp();
    const result = await remove("not-a-token", account.a);
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("invalid-token");
  });

  it("refuses a body with no verifier in it", async () => {
    const { session } = await signedUp();
    const result = await call<ErrorBody>("/v1/account/delete", {
      method: "POST",
      token: session.accessToken,
      body: {},
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-request");
  });
});

describe("deleting an account in the middle of a copy", () => {
  it("is allowed, because a move ends this way", async () => {
    // The last step of a move is deleting the source, and the source is frozen at that point.
    // Refusing here would mean thawing first, which is a window for a second machine to write.
    const { account, session } = await signedUp();
    await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), { ifNoneMatch: true });
    const frozen = await call("/v1/account/freeze", {
      method: "POST",
      token: session.accessToken,
      body: { state: "frozen" },
    });
    expect(frozen.status).toBe(200);

    const result = await remove(session.accessToken, account.a);
    expect(result.status).toBe(200);
    expect(result.body.recordsDeleted).toBe(1);

    const again = await register(newAccount({ email: account.email }));
    expect(again.status).toBe(201);
  });
});

describe("an address whose account was deleted", () => {
  it("is a stranger, not a special case", async () => {
    // There is no code meaning *this account was deleted*: a server that could tell the difference
    // would be keeping the row this route exists to remove (D4b).
    const { account, session } = await signedUp();
    await remove(session.accessToken, account.a);

    const attempt = await call<ErrorBody>("/v1/auth/login", {
      body: { email: account.email, a: account.a, deviceName: "reinstalled" },
    });
    expect(attempt.status).toBe(401);
    expect(attempt.body.error.code).toBe("invalid-credentials");

    const reopened = await call<ErrorBody>("/v1/auth/register", {
      body: registerBody(newAccount({ email: account.email })),
    });
    expect(reopened.status).toBe(201);
  });
});

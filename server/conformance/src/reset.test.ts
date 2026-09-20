import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  call,
  type ErrorBody,
  latestToken,
  login,
  newAccount,
  newEmail,
  newRecord,
  opaqueId,
  outbox,
  put,
  register,
  type Session,
  signedUp,
  since,
  verify,
} from "./client.js";

const askForReset = (email: string) => call("/v1/auth/reset", { body: { email } });

describe("asking for a reset", () => {
  it("answers 202 and sends a reset message", async () => {
    const { account } = await signedUp();
    const asked = await askForReset(account.email);
    expect(asked.status).toBe(202);

    const messages = await outbox(account.email);
    expect(messages.filter((message) => message.kind === "reset")).toHaveLength(1);
  });

  it("answers 202 for an address that has no account", async () => {
    // Registration has to refuse a taken address and therefore leaks one. This route has no such
    // obligation, so it does not: the answer is the same either way (D4a).
    const asked = await askForReset(newEmail());
    expect(asked.status).toBe(202);
  });
});

describe("completing a reset", () => {
  it("restores the login and abandons the data", async () => {
    // D6, case 3: every record is encrypted under an MK no surviving key unwraps, so the reset
    // deletes them rather than leaving an account full of bytes that decrypt for nobody.
    const account = newAccount();
    await register(account);
    await verify(account);
    const session = await login(account);

    const collection = opaqueId();
    for (let written = 0; written < 3; written += 1) {
      await put(session.accessToken, collection, opaqueId(), newRecord(), { ifNoneMatch: true });
    }

    await askForReset(account.email);
    const token = await latestToken(account.email, "reset");
    const fresh = newAccount({ email: account.email });

    const completed = await call<{ recordsDeleted: number }>("/v1/auth/reset", {
      body: {
        email: fresh.email,
        token,
        a: fresh.a,
        saltAccount: fresh.saltAccount,
        wrappedMkPassword: fresh.wrappedMkPassword,
        wrappedMkRecovery: fresh.wrappedMkRecovery,
      },
    });
    expect(completed.status).toBe(200);
    expect(completed.body.recordsDeleted).toBe(3);

    const after = await login(fresh);
    const page = await since(after.accessToken, 0);
    expect(page.body.records).toHaveLength(0);
  });

  it("leaves nothing behind for another machine to pull", async () => {
    // Outright, not tombstoned: a tombstone exists to tell a machine that something it can read is
    // gone, and after a reset no machine can read anything (D4a).
    const account = newAccount();
    await register(account);
    await verify(account);
    const session = await login(account);
    await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), { ifNoneMatch: true });

    await askForReset(account.email);
    const token = await latestToken(account.email, "reset");
    const fresh = newAccount({ email: account.email });
    await call("/v1/auth/reset", {
      body: {
        email: fresh.email,
        token,
        a: fresh.a,
        saltAccount: fresh.saltAccount,
        wrappedMkPassword: fresh.wrappedMkPassword,
        wrappedMkRecovery: fresh.wrappedMkRecovery,
      },
    });

    const after = await login(fresh);
    const page = await since(after.accessToken, 0);
    expect(page.body.records.filter((record) => record.deleted)).toHaveLength(0);
  });

  it("signs every machine out", async () => {
    const account = newAccount();
    await register(account);
    await verify(account);
    const desktop = await login(account, "desktop");

    await askForReset(account.email);
    const token = await latestToken(account.email, "reset");
    const fresh = newAccount({ email: account.email });
    await call("/v1/auth/reset", {
      body: {
        email: fresh.email,
        token,
        a: fresh.a,
        saltAccount: fresh.saltAccount,
        wrappedMkPassword: fresh.wrappedMkPassword,
        wrappedMkRecovery: fresh.wrappedMkRecovery,
      },
    });

    const refreshed = await call<Session & Partial<ErrorBody>>("/v1/auth/refresh", {
      body: { refreshToken: desktop.refreshToken },
    });
    expect(refreshed.status).toBe(401);
  });

  it("refuses a token that is not the one", async () => {
    const { account } = await signedUp();
    await askForReset(account.email);
    const fresh = newAccount({ email: account.email });

    const result = await call<ErrorBody>("/v1/auth/reset", {
      body: {
        email: fresh.email,
        token: "definitely-not-the-token",
        a: fresh.a,
        saltAccount: fresh.saltAccount,
        wrappedMkPassword: fresh.wrappedMkPassword,
        wrappedMkRecovery: fresh.wrappedMkRecovery,
      },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-token");
  });

  it("does not restart the sequence numbers", async () => {
    // `seq` is monotonic for the life of the account. Restarting it would hand a machine that
    // still holds an old cursor an answer that looks like "nothing has changed".
    const account = newAccount();
    await register(account);
    await verify(account);
    const session = await login(account);
    const before = await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });

    await askForReset(account.email);
    const token = await latestToken(account.email, "reset");
    const fresh = newAccount({ email: account.email });
    await call("/v1/auth/reset", {
      body: {
        email: fresh.email,
        token,
        a: fresh.a,
        saltAccount: fresh.saltAccount,
        wrappedMkPassword: fresh.wrappedMkPassword,
        wrappedMkRecovery: fresh.wrappedMkRecovery,
      },
    });

    const after = await login(fresh);
    const written = await put(after.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });
    expect(written.body.seq).toBeGreaterThan(before.body.seq);
  });

  it("does not change the address it was asked about", async () => {
    const { account } = await signedUp();
    await askForReset(account.email);
    const token = await latestToken(account.email, "reset");
    const elsewhere = newAccount({ email: newEmail() });

    const result = await call<ErrorBody>("/v1/auth/reset", {
      body: {
        email: elsewhere.email,
        token,
        a: elsewhere.a,
        saltAccount: elsewhere.saltAccount,
        wrappedMkPassword: elsewhere.wrappedMkPassword,
        wrappedMkRecovery: elsewhere.wrappedMkRecovery,
      },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-token");
  });
});

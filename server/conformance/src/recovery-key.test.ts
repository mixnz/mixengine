import { describe, expect, it } from "vitest";
import {
  call,
  type ErrorBody,
  latestToken,
  login,
  newAccount,
  newRecord,
  opaqueId,
  put,
  type Session,
  signedUp,
  since,
} from "./client.js";

// D6 case 2: the password is forgotten and the recovery key is held. `RK` unwraps `MK` on the
// machine, so the records survive — but a fresh install still has to prove whose account this is,
// and only the emailed code can do that. The recovery key preserves data; it does not prove
// identity.

interface Opened {
  wrappedMkRecovery: string;
  ticket: string;
  expiresIn: number;
}

const ask = (email: string) => call("/v1/auth/reset", { body: { email } });

const openWithCode = (email: string, token: string) =>
  call<Opened & Partial<ErrorBody>>("/v1/auth/reset", { body: { email, token } });

const finish = (email: string, ticket: string, fresh: ReturnType<typeof newAccount>) =>
  call<{ recordsDeleted: number } & Partial<ErrorBody>>("/v1/auth/reset", {
    body: {
      email,
      ticket,
      a: fresh.a,
      saltAccount: fresh.saltAccount,
      wrappedMkPassword: fresh.wrappedMkPassword,
      wrappedMkRecovery: fresh.wrappedMkRecovery,
    },
  });

describe("recovering with the recovery key", () => {
  it("hands back the wrapped key the machine needs, and a ticket", async () => {
    const { account } = await signedUp();
    const signedIn = await call<Session & { wrappedMkRecovery: string }>("/v1/auth/login", {
      body: { email: account.email, a: account.a, deviceName: "first" },
    });
    await ask(account.email);

    const opened = await openWithCode(account.email, await latestToken(account.email, "reset"));
    expect(opened.status).toBe(200);
    // **The same bytes login returns**, or the client cannot unwrap MK with it.
    expect(opened.body.wrappedMkRecovery).toBe(signedIn.body.wrappedMkRecovery);
    expect(typeof opened.body.ticket).toBe("string");
    expect(opened.body.expiresIn).toBeGreaterThan(0);
  });

  it("keeps every record, which is the whole point of holding the key", async () => {
    const { account, session } = await signedUp();
    const collection = opaqueId();
    for (let written = 0; written < 3; written += 1) {
      await put(session.accessToken, collection, opaqueId(), newRecord(), { ifNoneMatch: true });
    }

    await ask(account.email);
    const opened = await openWithCode(account.email, await latestToken(account.email, "reset"));
    const fresh = newAccount({ email: account.email });
    const done = await finish(account.email, opened.body.ticket, fresh);

    expect(done.status).toBe(200);
    expect(done.body.recordsDeleted).toBe(0);

    const after = await login(fresh);
    const page = await since(after.accessToken, 0, collection);
    expect(page.body.records).toHaveLength(3);
  });

  it("signs every machine out, the same as case 3", async () => {
    const { account, session } = await signedUp();
    await ask(account.email);
    const opened = await openWithCode(account.email, await latestToken(account.email, "reset"));
    await finish(account.email, opened.body.ticket, newAccount({ email: account.email }));

    const refreshed = await call<Session & Partial<ErrorBody>>("/v1/auth/refresh", {
      body: { refreshToken: session.refreshToken },
    });
    expect(refreshed.status).toBe(401);
  });

  it("spends the ticket once", async () => {
    const { account } = await signedUp();
    await ask(account.email);
    const opened = await openWithCode(account.email, await latestToken(account.email, "reset"));

    const first = await finish(
      account.email,
      opened.body.ticket,
      newAccount({ email: account.email }),
    );
    expect(first.status).toBe(200);

    const again = await finish(
      account.email,
      opened.body.ticket,
      newAccount({ email: account.email }),
    );
    expect(again.status).toBe(401);
    expect(again.body.error?.code).toBe("invalid-token");
  });

  it("spends the code once, so the ticket cannot be minted twice", async () => {
    const { account } = await signedUp();
    await ask(account.email);
    const code = await latestToken(account.email, "reset");
    expect((await openWithCode(account.email, code)).status).toBe(200);

    const again = await openWithCode(account.email, code);
    expect(again.status).toBe(400);
    expect(again.body.error?.code).toBe("invalid-code");
  });

  it("refuses a ticket that belongs to another account", async () => {
    const mine = await signedUp();
    const theirs = await signedUp();
    await ask(theirs.account.email);
    const opened = await openWithCode(
      theirs.account.email,
      await latestToken(theirs.account.email, "reset"),
    );

    const result = await finish(
      mine.account.email,
      opened.body.ticket,
      newAccount({ email: mine.account.email }),
    );
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("invalid-token");
  });

  it("refuses a code that is not the one", async () => {
    const { account } = await signedUp();
    await ask(account.email);
    const result = await openWithCode(account.email, "ZZZZ-ZZZZ");
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("invalid-code");
  });

  it("lets a ticket expire", async ({ skip }) => {
    const { account } = await signedUp();
    await ask(account.email);
    const opened = await openWithCode(account.email, await latestToken(account.email, "reset"));
    if (!(opened.body.expiresIn <= 10)) {
      skip(`this server issues a ${opened.body.expiresIn}s ticket; run one with a short one`);
    }

    await new Promise((resume) => setTimeout(resume, (opened.body.expiresIn + 2) * 1000));
    const result = await finish(
      account.email,
      opened.body.ticket,
      newAccount({ email: account.email }),
    );
    expect(result.status).toBe(401);
  });
});

describe("case 3 is untouched", () => {
  it("still deletes when the code carries the new keys", async () => {
    const { account, session } = await signedUp();
    await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), { ifNoneMatch: true });
    await ask(account.email);
    const fresh = newAccount({ email: account.email });

    const done = await call<{ recordsDeleted: number }>("/v1/auth/reset", {
      body: {
        email: account.email,
        token: await latestToken(account.email, "reset"),
        a: fresh.a,
        saltAccount: fresh.saltAccount,
        wrappedMkPassword: fresh.wrappedMkPassword,
        wrappedMkRecovery: fresh.wrappedMkRecovery,
      },
    });
    expect(done.status).toBe(200);
    expect(done.body.recordsDeleted).toBe(1);
  });
});

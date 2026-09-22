import { describe, expect, it } from "vitest";
import {
  call,
  type ErrorBody,
  latestToken,
  newAccount,
  register,
  registerBody,
  verify,
} from "./client.js";

describe("POST /v1/auth/register", () => {
  it("creates an account and answers 201", async () => {
    const result = await register(newAccount());
    expect(result.status).toBe(201);
  });

  it("refuses an address that already has a verified account", async () => {
    const account = newAccount();
    expect((await register(account)).status).toBe(201);
    await verify(account);

    const again = await call<ErrorBody>("/v1/auth/register", { body: registerBody(account) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("email-taken");
  });

  it("replaces an account whose address was never confirmed", async () => {
    // A verification token lives a day. Without this rule, letting one expire leaves a person who
    // cannot verify, cannot register again and cannot reset — a reset is only offered to an
    // address that proved itself. Replacing loses nothing: no record may be written before
    // verification, so there is never anything there to lose (D4a).
    const first = newAccount();
    expect((await register(first)).status).toBe(201);
    const stale = await latestToken(first.email, "verification");

    const second = newAccount({ email: first.email });
    expect((await register(second)).status).toBe(201);

    // The letter that went out is a new one, and the old token is not the account's any more.
    const fresh = await latestToken(first.email, "verification");
    expect(fresh).not.toBe(stale);

    const replayed = await call<ErrorBody>("/v1/auth/verify", {
      body: { email: first.email, token: stale },
    });
    expect(replayed.status).toBe(400);

    // And the account that exists is the second one: its verifier is what signs in.
    expect((await call("/v1/auth/verify", { body: { email: first.email, token: fresh } })).status)
      .toBe(200);
    const withSecond = await call("/v1/auth/login", {
      body: { email: second.email, a: second.a, deviceName: "conformance" },
    });
    expect(withSecond.status).toBe(200);
    const withFirst = await call<ErrorBody>("/v1/auth/login", {
      body: { email: first.email, a: first.a, deviceName: "conformance" },
    });
    expect(withFirst.status).toBe(401);
  });

  it("treats an address as one address whatever its casing", async () => {
    // D8 addresses an account object by the hash of the lowercased address, so `Foo@` and `foo@`
    // must be the same account — otherwise a person who typed a capital at registration cannot
    // sign in, and the server holds two accounts it can never tell apart.
    const account = newAccount({ email: `Conformance-${Date.now()}@Example.Invalid` });
    expect((await register(account)).status).toBe(201);
    await verify(account);

    const lowercased = { ...account, email: account.email.toLowerCase() };
    const again = await call<ErrorBody>("/v1/auth/register", { body: registerBody(lowercased) });
    expect(again.status).toBe(409);
  });

  it.each([
    ["no verifier", { a: undefined }],
    ["no salt", { saltAccount: undefined }],
    ["no wrapped key", { wrappedMkPassword: undefined }],
  ])("refuses a body with %s", async (_label, override) => {
    const body = { ...registerBody(newAccount()), ...override };
    const result = await call<ErrorBody>("/v1/auth/register", { body });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-request");
  });

  it.each([
    ["no address at all", { email: undefined }],
    ["something that is not one", { email: "not-an-address" }],
    ["two of them", { email: "a@b.com,c@d.com" }],
    // A name and an address: every such spelling is an account and a letter counter of its own,
    // all delivered to one mailbox, and the name is the sender's to choose.
    ["a name in front of one", { email: "someone<victim@example.com>" }],
    ["a quoted name in front of one", { email: '"MixLab"<victim@example.com>' }],
    ["a comma inside one", { email: "some,one@example.com" }],
  ])("says it is the address that is wrong, given %s", async (_label, override) => {
    // A person typed this one, so it cannot share a code with a wrong-length key: an application
    // showing "something in what you sent is wrong" for a mistyped address shows the wrong
    // sentence, and a translated one has no better string to reach for (D4a).
    const body = { ...registerBody(newAccount()), ...override };
    const result = await call<ErrorBody>("/v1/auth/register", { body });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-email");
  });

  it("says it is the name of the machine that is wrong", async () => {
    const account = newAccount();
    await register(account);
    await verify(account);

    const result = await call<ErrorBody>("/v1/auth/login", {
      body: { email: account.email, a: account.a, deviceName: "   " },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-device-name");
  });

  it("answers every failure in the one error shape", async () => {
    const result = await call<ErrorBody>("/v1/auth/register", { body: {} });
    expect(result.body.error).toBeTypeOf("object");
    expect(result.body.error.code).toBeTypeOf("string");
    expect(result.body.error.message).toBeTypeOf("string");
  });
});

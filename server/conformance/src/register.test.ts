import { describe, expect, it } from "vitest";
import { call, type ErrorBody, newAccount, register, registerBody } from "./client.js";

describe("POST /v1/auth/register", () => {
  it("creates an account and answers 201", async () => {
    const result = await register(newAccount());
    expect(result.status).toBe(201);
  });

  it("refuses an address that already has one", async () => {
    const account = newAccount();
    expect((await register(account)).status).toBe(201);

    const again = await call<ErrorBody>("/v1/auth/register", { body: registerBody(account) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("email-taken");
  });

  it("treats an address as one address whatever its casing", async () => {
    // D8 addresses an account object by the hash of the lowercased address, so `Foo@` and `foo@`
    // must be the same account — otherwise a person who typed a capital at registration cannot
    // sign in, and the server holds two accounts it can never tell apart.
    const account = newAccount({ email: `Conformance-${Date.now()}@Example.Invalid` });
    expect((await register(account)).status).toBe(201);

    const lowercased = { ...account, email: account.email.toLowerCase() };
    const again = await call<ErrorBody>("/v1/auth/register", { body: registerBody(lowercased) });
    expect(again.status).toBe(409);
  });

  it.each([
    ["no email", { email: undefined }],
    ["no verifier", { a: undefined }],
    ["no salt", { saltAccount: undefined }],
    ["no wrapped key", { wrappedMkPassword: undefined }],
    ["an address that is not one", { email: "not-an-address" }],
  ])("refuses a body with %s", async (_label, override) => {
    const body = { ...registerBody(newAccount()), ...override };
    const result = await call<ErrorBody>("/v1/auth/register", { body });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalid-request");
  });

  it("answers every failure in the one error shape", async () => {
    const result = await call<ErrorBody>("/v1/auth/register", { body: {} });
    expect(result.body.error).toBeTypeOf("object");
    expect(result.body.error.code).toBeTypeOf("string");
    expect(result.body.error.message).toBeTypeOf("string");
  });
});

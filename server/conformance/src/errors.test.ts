import { describe, expect, it } from "vitest";
import {
  accessHeaders,
  baseUrl,
  call,
  type Capabilities,
  type ErrorBody,
  opaqueId,
  signedUp,
} from "./client.js";

// MixLab picks the sentence it shows from `code`, because it is translated (D4a). An answer with no
// code is an answer it can only show in English or not at all — so this file is about the envelope
// rather than about any one route.

const isError = (body: unknown): body is ErrorBody => {
  const error = (body as ErrorBody | undefined)?.error;
  return typeof error?.code === "string" && typeof error?.message === "string";
};

describe("every refusal carries a code", () => {
  it("on a route that does not exist", async () => {
    const result = await call<ErrorBody>("/v1/there-is-no-such-thing");
    expect(result.status).toBe(404);
    expect(result.headers.get("content-type") ?? "").toContain("json");
    expect(isError(result.body)).toBe(true);
    expect(result.body.error.code).toBe("not-found");
  });

  it("on a method a route does not answer", async () => {
    // A framework answers this one on its own, and answers it in plain text with an empty body.
    // That is nothing for a translated application to work with.
    const result = await call<ErrorBody>("/v1/capabilities", { method: "POST", body: {} });
    expect(result.status).toBe(405);
    expect(result.headers.get("content-type") ?? "").toContain("json");
    expect(isError(result.body)).toBe(true);
    expect(result.body.error.code).toBe("method-not-allowed");
  });

  it("on a request larger than the server will take", async () => {
    // `maxBatchOperations` times `maxRecordBytes` is a number no server intends to buffer, so
    // without a third figure a client can compose a request every other limit calls legal.
    const limits = (await call<Capabilities>("/v1/capabilities")).body;
    const { session } = await signedUp();

    const response = await fetch(`${baseUrl()}/v1/records/batch`, {
      method: "POST",
      headers: {
        ...accessHeaders(),
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: `{"operations":[${`{"op":"put","collection":"${opaqueId()}"},`.repeat(
        Math.ceil(limits.maxBatchBytes / 80) + 1000,
      )}{}]}`,
    });

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type") ?? "").toContain("json");
    const body = await response.json();
    expect(isError(body)).toBe(true);
    expect((body as ErrorBody).error.code).toBe("request-too-large");
    expect((body as ErrorBody).error["limit"]).toBe(limits.maxBatchBytes);
  });

  it("on a body that is not JSON at all", async () => {
    const result = await call<ErrorBody>("/v1/auth/login", { method: "POST", body: undefined });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(isError(result.body)).toBe(true);
  });
});

describe("the codes a person is shown are told apart", () => {
  it("a wrong code from a letter is not a session that has ended", async () => {
    // One means "check what you typed" and the other means "you have been signed out". Sharing a
    // code left a translated application with one string to cover both (D4a).
    const { account } = await signedUp();
    const wrongCode = await call<ErrorBody>("/v1/auth/verify", {
      body: { email: account.email, token: "ZZZZ-ZZZZ" },
    });
    const deadSession = await call<ErrorBody>("/v1/records?since=0", { token: "not-a-token" });

    expect(wrongCode.body.error.code).toBe("invalid-code");
    expect(deadSession.body.error.code).toBe("invalid-token");
    expect(wrongCode.body.error.code).not.toBe(deadSession.body.error.code);
  });

  it("a mistyped address is not a malformed request", async () => {
    const badAddress = await call<ErrorBody>("/v1/auth/params?email=not-an-address");
    expect(badAddress.body.error.code).toBe("invalid-email");
  });
});

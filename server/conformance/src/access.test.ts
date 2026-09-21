import { describe, expect, it } from "vitest";
import { baseUrl, type ErrorBody } from "./client.js";

// A deployment somebody runs for their own company may be closed with a shared token (D4a). These
// run against an instance that has one; against the hosted shape, which never does, they skip.

const gated = () => Boolean(process.env.CONFORMANCE_ACCESS_TOKEN);

const bare = (path: string, token?: string) =>
  fetch(`${baseUrl()}${path}`, {
    headers: token ? { "X-MixLab-Access": token } : {},
  });

describe("a server one company runs for itself", () => {
  it("lets nobody past without the token, not even to read its limits", async ({ skip }) => {
    if (!gated()) skip("this server is open, which is what a hosted instance is");

    // `/v1/capabilities` included, on purpose: answering it would tell somebody who found the
    // address that the server is there, what it allows, and that it is worth coming back to.
    const response = await bare("/v1/capabilities");
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("invalid-access-token");
  });

  it("says that in its own code, not the one that means a session ended", async ({ skip }) => {
    if (!gated()) skip("this server is open");

    // One is "ask your administrator for the token" and the other is "sign in again". MixLab
    // cannot pick between those two sentences from a status alone.
    const response = await bare("/v1/records?since=0", "definitely-not-the-token");
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("invalid-access-token");
  });

  it("lets the token through", async ({ skip }) => {
    if (!gated()) skip("this server is open");

    const response = await bare("/v1/capabilities", process.env.CONFORMANCE_ACCESS_TOKEN);
    expect(response.status).toBe(200);
  });

  it("is open when nobody configured one", async ({ skip }) => {
    if (gated()) skip("this server is closed, so the open case is somewhere else");

    // The hosted instances never set one: anybody may make an account there, which is what they
    // are for.
    const response = await bare("/v1/capabilities");
    expect(response.status).toBe(200);
  });
});

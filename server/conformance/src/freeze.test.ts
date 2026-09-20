import { describe, expect, it } from "vitest";
import {
  call,
  type ErrorBody,
  newRecord,
  opaqueId,
  put,
  seed,
  type Session,
  signedUp,
  since,
} from "./client.js";

// A freeze is the whole of what a server contributes to a copy (D4b): it holds still while the
// client carries the account somewhere else. There is no state beyond these two, and nothing here
// knows where the copy is going — the destination is a thing a person typed into MixLab.

interface Freeze {
  state: "active" | "frozen";
  frozenUntil: number | null;
}

const read = (token: string) => call<Freeze & Partial<ErrorBody>>("/v1/account/freeze", { token });

const set = (token: string, state: string) =>
  call<Freeze & Partial<ErrorBody>>("/v1/account/freeze", {
    method: "POST",
    token,
    body: { state },
  });

const seconds = () => Math.floor(Date.now() / 1000);

describe("an account nobody is copying", () => {
  it("says so", async () => {
    const { session } = await signedUp();
    const current = await read(session.accessToken);

    expect(current.status).toBe(200);
    expect(current.body.state).toBe("active");
    expect(current.body.frozenUntil).toBeNull();
  });

  it("refuses a state that is not one of the two", async () => {
    const { session } = await signedUp();
    const result = await set(session.accessToken, "retired");
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("invalid-request");
  });

  it("refuses a stranger", async () => {
    const result = await read("not-a-token");
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("invalid-token");
  });
});

describe("an account being copied elsewhere", () => {
  it("stops accepting writes, and keeps answering reads", async () => {
    const { session } = await signedUp();
    const { collection, id, stored } = await seed(session.accessToken);

    const frozen = await set(session.accessToken, "frozen");
    expect(frozen.status).toBe(200);
    expect(frozen.body.state).toBe("frozen");
    expect(frozen.body.frozenUntil).toBeGreaterThan(seconds());

    const written = await put(session.accessToken, collection, id, newRecord(), {
      ifMatch: stored.version,
    });
    expect(written.status).toBe(423);
    expect(written.body.error?.code).toBe("account-frozen");

    // Reads stay open: the machine doing the copying has to be able to read what it is copying.
    const page = await since(session.accessToken, 0, collection);
    expect(page.status).toBe(200);
    expect(page.body.records).toHaveLength(1);
  });

  it("leaves every session alone", async () => {
    // The copy is done by a signed-in client, and a second machine has to be able to look at the
    // state and decide whether to take over. Neither survives being signed out.
    const { session } = await signedUp();
    await set(session.accessToken, "frozen");

    const refreshed = await call<Session & Partial<ErrorBody>>("/v1/auth/refresh", {
      body: { refreshToken: session.refreshToken },
    });
    expect(refreshed.status).toBe(200);
  });

  it("pushes the lease out when it is asked again", async () => {
    // Re-arming is how a client that is still copying says it is alive. Without it, a long copy
    // would thaw underneath itself.
    const { session } = await signedUp();
    const first = await set(session.accessToken, "frozen");
    await new Promise((resume) => setTimeout(resume, 1100));
    const second = await set(session.accessToken, "frozen");

    expect(second.body.state).toBe("frozen");
    expect(second.body.frozenUntil).toBeGreaterThan(first.body.frozenUntil ?? 0);
  });

  it("is thawed by the client that finished, not by waiting", async () => {
    // Posting `active` is the normal way out of a freeze — the client that finished copying, or
    // the one that gave up. The lease below is for the client that can no longer post anything.
    const { session } = await signedUp();
    const { collection, id, stored } = await seed(session.accessToken);
    await set(session.accessToken, "frozen");

    const thawed = await set(session.accessToken, "active");
    expect(thawed.status).toBe(200);
    expect(thawed.body.state).toBe("active");
    expect(thawed.body.frozenUntil).toBeNull();

    const written = await put(session.accessToken, collection, id, newRecord(), {
      ifMatch: stored.version,
    });
    expect(written.status).toBe(200);
  });

  it("thaws itself when nobody comes back", async ({ skip }) => {
    // **The failure this design exists to survive**: a machine freezes the account, starts
    // uploading, and loses the network or the power. With a latch that account is unwritable for
    // ever; with a lease it repairs itself (D4b). Only reachable against a server configured with
    // a short one — a real lease is fifteen minutes and no test can wait that out.
    const { session } = await signedUp();
    const frozen = await set(session.accessToken, "frozen");
    const lease = (frozen.body.frozenUntil ?? 0) - seconds();
    if (lease > 10) {
      skip(`this server leases a freeze for ${lease}s; run one with a short lease to cover lapsing`);
    }

    let current = await read(session.accessToken);
    for (let attempt = 0; attempt < 40 && current.body.state !== "active"; attempt += 1) {
      await new Promise((resume) => setTimeout(resume, 500));
      current = await read(session.accessToken);
    }

    expect(current.body.state).toBe("active");
    const written = await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });
    expect(written.status).toBe(201);
  });
});

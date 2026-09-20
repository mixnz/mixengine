import { describe, expect, it } from "vitest";
import {
  call,
  type ErrorBody,
  login,
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
  frozenAt: number | null;
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
    expect(current.body.frozenAt).toBeNull();
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
    expect(frozen.body.frozenAt).toBeLessThanOrEqual(seconds());

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

  it("stays frozen, because nothing is coming to clear it", async () => {
    // **There is no timeout.** A copy that succeeded and was never followed up would otherwise
    // reopen the old server on a timer, for a machine nobody repointed to write into (D4b). A
    // freeze that stays frozen refuses that machine every time instead, until a person decides.
    const { session } = await signedUp();
    const first = await set(session.accessToken, "frozen");
    await new Promise((resume) => setTimeout(resume, 3000));

    const still = await read(session.accessToken);
    expect(still.body.state).toBe("frozen");
    expect(still.body.frozenAt).toBe(first.body.frozenAt);

    const written = await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });
    expect(written.status).toBe(423);
  });

  it("is idempotent, so a client may say it twice", async () => {
    const { session } = await signedUp();
    const first = await set(session.accessToken, "frozen");
    const second = await set(session.accessToken, "frozen");

    expect(second.status).toBe(200);
    expect(second.body.state).toBe("frozen");
    // The clock does not restart: `frozenAt` is when this began, which is what a client shows a
    // person who is being told their account has been read-only for a while.
    expect(second.body.frozenAt).toBe(first.body.frozenAt);
  });

  it("is thawed by the client that finished, not by waiting", async () => {
    // Posting `active` is the only way out of a freeze: the client that finished copying, or the
    // one that gave up. Waiting is not a third option.
    const { session } = await signedUp();
    const { collection, id, stored } = await seed(session.accessToken);
    await set(session.accessToken, "frozen");

    const thawed = await set(session.accessToken, "active");
    expect(thawed.status).toBe(200);
    expect(thawed.body.state).toBe("active");
    expect(thawed.body.frozenAt).toBeNull();

    const written = await put(session.accessToken, collection, id, newRecord(), {
      ifMatch: stored.version,
    });
    expect(written.status).toBe(200);
  });

  it("is cleared by any machine on the account, which is why no timeout is needed", async () => {
    // The argument for a lease was a freeze nobody could clear. Every signed-in machine can clear
    // one, and signing in works while frozen, so a copy cut off by a dead machine is one request
    // away from over — from a second machine, or from a reinstall (D4b).
    const { account, session } = await signedUp();
    await set(session.accessToken, "frozen");

    const elsewhere = await login(account, "another-machine");
    const seen = await read(elsewhere.accessToken);
    expect(seen.body.state).toBe("frozen");

    const thawed = await set(elsewhere.accessToken, "active");
    expect(thawed.status).toBe(200);
    expect(thawed.body.state).toBe("active");

    const written = await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });
    expect(written.status).toBe(201);
  });
});

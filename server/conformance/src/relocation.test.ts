import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  call,
  type ErrorBody,
  newAccount,
  newRecord,
  opaqueId,
  put,
  registerBody,
  seed,
  signedUp,
  since,
} from "./client.js";

interface Relocation {
  state: "active" | "frozen" | "retired";
  home: string | null;
  frozenUntil: number | null;
}

const read = (token: string) =>
  call<Relocation & Partial<ErrorBody>>("/v1/account/relocation", { token });

const set = (token: string, state: string) =>
  call<Relocation & Partial<ErrorBody>>("/v1/account/relocation", {
    method: "POST",
    token,
    body: { state },
  });

const seconds = () => Math.floor(Date.now() / 1000);

describe("an account that has not moved", () => {
  it("says so", async () => {
    const { session } = await signedUp();
    const current = await read(session.accessToken);

    expect(current.status).toBe(200);
    expect(current.body.state).toBe("active");
    expect(current.body.frozenUntil).toBeNull();
  });

  it("refuses to be retired without being frozen first", async () => {
    // Retiring straight from active leaves a window in which a second machine writes something the
    // copy never saw, and two servers cannot be reconciled afterwards — their sequence numbers are
    // independent (D4b).
    const { session } = await signedUp();
    const result = await set(session.accessToken, "retired");

    expect(result.status).toBe(409);
    expect(result.body.error?.code).toBe("must-freeze-first");
  });

  it("refuses a state that is not one of the three", async () => {
    const { session } = await signedUp();
    const result = await set(session.accessToken, "somewhere-else");
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("invalid-request");
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

  it("can be thawed, because a copy that fails halfway must not strand anybody", async () => {
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

describe("an account that has moved", () => {
  const retire = async () => {
    const { account, session } = await signedUp();
    expect((await set(session.accessToken, "frozen")).status).toBe(200);
    const retired = await set(session.accessToken, "retired");
    return { account, session, retired };
  };

  it("names where it went, and stops answering for itself", async ({ skip }) => {
    const { session } = await signedUp();
    await set(session.accessToken, "frozen");
    const retired = await set(session.accessToken, "retired");
    if (retired.status === 409) {
      skip("this server has nowhere to send an account, so it will not let go of one");
    }

    expect(retired.status).toBe(200);
    expect(retired.body.state).toBe("retired");
    expect(retired.body.home).toBeTypeOf("string");

    const page = await since(session.accessToken, 0);
    expect(page.status).toBe(410);
    expect(page.body.error?.code).toBe("account-moved");
    expect(page.body.error?.["home"]).toBe(retired.body.home);
  });

  it("still says where it went, which is the whole point", async ({ skip }) => {
    const { session, retired } = await retire();
    if (retired.status === 409) skip("this server has nowhere to send an account");

    // `GET` answers in every state, including this one: a machine that meets a refusal has to be
    // able to find out why.
    const current = await read(session.accessToken);
    expect(current.status).toBe(200);
    expect(current.body.state).toBe("retired");
    expect(current.body.home).toBe(retired.body.home);
  });

  it("tells somebody who proves the password, and nobody else", async ({ skip }) => {
    const { account, retired } = await retire();
    if (retired.status === 409) skip("this server has nowhere to send an account");

    // A fresh install signs in here, and this is how it learns to look elsewhere.
    const right = await call<ErrorBody>("/v1/auth/login", {
      body: { email: account.email, a: account.a, deviceName: "reinstalled" },
    });
    expect(right.status).toBe(410);
    expect(right.body.error.code).toBe("account-moved");
    expect(right.body.error["home"]).toBe(retired.body.home);

    // And a wrong password learns nothing: otherwise this is a cheaper enumeration oracle than the
    // 409 that registration already admits to (D4b).
    const wrong = await call<ErrorBody>("/v1/auth/login", {
      body: { email: account.email, a: base64Bytes(32), deviceName: "stranger" },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid-credentials");
  });

  it("does not hand the address back to somebody new", async ({ skip }) => {
    const { account, retired } = await retire();
    if (retired.status === 409) skip("this server has nowhere to send an account");

    const again = await call<ErrorBody>("/v1/auth/register", {
      body: registerBody(newAccount({ email: account.email })),
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("email-taken");
  });

  it("cannot be moved again", async ({ skip }) => {
    const { session, retired } = await retire();
    if (retired.status === 409) skip("this server has nowhere to send an account");

    const result = await set(session.accessToken, "active");
    expect(result.status).toBe(410);
    expect(result.body.error?.code).toBe("account-moved");
  });
});

describe("a server with nowhere to send an account", () => {
  it("will not let go of one", async ({ skip }) => {
    const { session } = await signedUp();
    await set(session.accessToken, "frozen");
    const retired = await set(session.accessToken, "retired");
    if (retired.status === 200) {
      skip("this server has somewhere to send an account, so the refusal is unreachable");
    }

    // Better a stuck account than one pointed at nothing: the client would strand itself.
    expect(retired.status).toBe(409);
    expect(retired.body.error?.code).toBe("relocation-not-configured");
  });
});

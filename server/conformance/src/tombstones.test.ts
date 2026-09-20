import { describe, expect, it } from "vitest";
import {
  call,
  type Capabilities,
  newRecord,
  opaqueId,
  put,
  remove,
  seed,
  signedUp,
  since,
} from "./client.js";

describe("tombstones", () => {
  it("travel on the cursor so another machine learns of the deletion", async () => {
    const { session } = await signedUp();
    const { collection, id, stored } = await seed(session.accessToken);
    const deleted = await remove(session.accessToken, collection, id, stored.version);

    const page = await since(session.accessToken, stored.seq, collection);
    const tombstone = page.body.records.find((record) => record.id === id);

    expect(tombstone?.deleted).toBe(true);
    expect(tombstone?.seq).toBe(deleted.body.seq);
    expect(tombstone?.ciphertext ?? null).toBeNull();
  });

  it("can be brought back to life by a write", async () => {
    // A person who deletes a saved query on one machine and creates one with the same local uuid
    // on another must not be told the record does not exist. The tombstone is a version like any
    // other, and a matching If-Match writes over it.
    const { session } = await signedUp();
    const { collection, id, stored } = await seed(session.accessToken);
    const tombstone = await remove(session.accessToken, collection, id, stored.version);

    const revived = await put(session.accessToken, collection, id, newRecord(), {
      ifMatch: tombstone.body.version,
    });
    expect(revived.status).toBe(200);
    expect(revived.body.deleted).toBe(false);
    expect(revived.body.version).toBe(tombstone.body.version + 1);
    expect(revived.body.ciphertext).toBeTypeOf("string");
  });

  it("do not let a creation slip past a deletion", async () => {
    const { session } = await signedUp();
    const { collection, id, stored } = await seed(session.accessToken);
    await remove(session.accessToken, collection, id, stored.version);

    const created = await put(session.accessToken, collection, id, newRecord(), { ifNoneMatch: true });
    expect(created.status).toBe(412);
    expect(created.body.error?.code).toBe("already-exists");
  });

  it("expire a cursor that has been away longer than they live", async ({ skip }) => {
    // D3: a machine offline longer than the retention is told to resync from empty rather than
    // told incomplete news quietly. The suite can only reach that state against a server
    // configured to reap at once; ninety days is not something a test can wait out.
    const limits = (await call<Capabilities>("/v1/capabilities")).body;
    if (limits.tombstoneRetentionDays !== 0) {
      skip(
        `this server reports tombstoneRetentionDays=${limits.tombstoneRetentionDays}. Run a second ` +
          "instance with a retention of 0 to cover cursor expiry; no test can wait ninety days.",
      );
    }

    const { session } = await signedUp();
    // A cursor that has seen something, and a deletion after it. `since=0` is exempt on purpose:
    // a machine with no history has missed nothing, so it is told to start rather than to resync.
    const anchor = await seed(session.accessToken);
    const doomed = await seed(session.accessToken);
    await remove(session.accessToken, doomed.collection, doomed.id, doomed.stored.version);

    // Reaping is a scheduled job and not part of the write that caused it — D8 schedules an alarm
    // rather than sweeping inline, so a test has to allow for the gap rather than assume it away.
    let page = await since(session.accessToken, anchor.stored.seq);
    for (let attempt = 0; attempt < 40 && page.status !== 410; attempt += 1) {
      await new Promise((resume) => setTimeout(resume, 500));
      page = await since(session.accessToken, anchor.stored.seq);
    }

    expect(page.status).toBe(410);
    expect(page.body.error?.code).toBe("cursor-expired");
  });

  it("do not expire a cursor that is current", async () => {
    const { session } = await signedUp();
    const page = await since(session.accessToken, 0);
    expect(page.status).toBe(200);
  });
});

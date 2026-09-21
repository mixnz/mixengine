import { describe, expect, it } from "vitest";
import {
  call,
  type ErrorBody,
  login,
  newRecord,
  opaqueId,
  put,
  remove,
  signedUp,
  since,
  type StoredRecord,
} from "./client.js";

// A record carries the device whose session wrote it, stamped by the server (D3). It is what D4's
// tie-break reads, and a client cannot choose it: a `device` in the body is ignored.

describe("the device on a record", () => {
  it("is the device that wrote it", async () => {
    const { session } = await signedUp("desktop");
    const written = await put(session.accessToken, opaqueId(), opaqueId(), newRecord(), {
      ifNoneMatch: true,
    });
    expect(written.status).toBe(201);
    expect(written.body.device).toBe(session.deviceId);
  });

  it("is not the client's to claim", async () => {
    const { session } = await signedUp();
    const result = await call<StoredRecord>(`/v1/records/${opaqueId()}/${opaqueId()}`, {
      method: "PUT",
      token: session.accessToken,
      headers: { "If-None-Match": "*" },
      body: { ...newRecord(), device: "somebody-else" },
    });
    expect(result.status).toBe(201);
    expect(result.body.device).toBe(session.deviceId);
  });

  it("changes hands when another machine writes over it", async () => {
    const { account, session } = await signedUp("desktop");
    const laptop = await login(account, "laptop");
    const collection = opaqueId();
    const id = opaqueId();
    const first = await put(session.accessToken, collection, id, newRecord(), { ifNoneMatch: true });
    const second = await put(laptop.accessToken, collection, id, newRecord(), {
      ifMatch: first.body.version,
    });
    expect(second.body.device).toBe(laptop.deviceId);
  });

  it("is on the record a conflict hands back", async () => {
    // The tie-break runs on exactly this: the record the server holds, and who wrote it.
    const { account, session } = await signedUp("desktop");
    const laptop = await login(account, "laptop");
    const collection = opaqueId();
    const id = opaqueId();
    const first = await put(session.accessToken, collection, id, newRecord(), { ifNoneMatch: true });
    await put(laptop.accessToken, collection, id, newRecord(), { ifMatch: first.body.version });

    const stale = await put(session.accessToken, collection, id, newRecord(), {
      ifMatch: first.body.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.device).toBe(laptop.deviceId);
  });

  it("is on a tombstone, as the device that deleted it", async () => {
    const { account, session } = await signedUp("desktop");
    const laptop = await login(account, "laptop");
    const collection = opaqueId();
    const id = opaqueId();
    const written = await put(session.accessToken, collection, id, newRecord(), { ifNoneMatch: true });

    const removed = await remove(laptop.accessToken, collection, id, written.body.version);
    expect(removed.body.deleted).toBe(true);
    expect(removed.body.device).toBe(laptop.deviceId);
  });

  it("travels on a page", async () => {
    const { session } = await signedUp();
    const collection = opaqueId();
    await put(session.accessToken, collection, opaqueId(), newRecord(), { ifNoneMatch: true });

    const page = await since(session.accessToken, 0, collection);
    expect(page.body.records[0]?.device).toBe(session.deviceId);
  });

  it("travels through a batch", async () => {
    const { session } = await signedUp();
    const result = await call<
      { results: { status: number; record: StoredRecord }[] } & Partial<ErrorBody>
    >("/v1/records/batch", {
      token: session.accessToken,
      body: {
        operations: [
          { op: "put", collection: opaqueId(), id: opaqueId(), ifNoneMatch: true, record: newRecord() },
        ],
      },
    });
    expect(result.body.results[0]?.status).toBe(201);
    expect(result.body.results[0]?.record.device).toBe(session.deviceId);
  });
});

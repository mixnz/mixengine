import { describe, expect, it } from "vitest";
import { connectionFromSync, connectionToSync } from "./sync";
import type { SavedConnection } from "./types";

const local: SavedConnection = {
  id: "c1",
  name: "Production",
  config: { kind: "postgres", host: "db", port: 5432, username: "app", password: "hunter2" } as never,
  sidebarWidth: 280,
  pinned: true,
  readOnly: true,
};

describe("what travels of a connection", () => {
  it("is what it is, never a credential or a layout", () => {
    const synced = connectionToSync(local);
    expect(synced.id).toBe("c1");
    expect(JSON.stringify(synced.data)).not.toContain("hunter2");
    expect(synced.data).not.toHaveProperty("sidebarWidth");
    expect(synced.data).not.toHaveProperty("pinned");
    expect(synced.data).toMatchObject({ name: "Production", readOnly: true });
  });

  it("keeps this machine's password and layout when another machine renames it", () => {
    const { data } = connectionToSync(local);
    const renamed = connectionFromSync({ id: "c1", data: { ...(data as object), name: "Prod" } }, local);
    expect(renamed?.name).toBe("Prod");
    expect(renamed?.config).toMatchObject({ password: "hunter2" });
    expect(renamed?.sidebarWidth).toBe(280);
    expect(renamed?.pinned).toBe(true);
  });

  it("arrives without a password when this machine never had it", () => {
    const { data } = connectionToSync(local);
    const arrived = connectionFromSync({ id: "new", data }, undefined);
    expect(arrived?.config).not.toHaveProperty("password", "hunter2");
    expect(arrived?.sidebarWidth).toBeUndefined();
  });

  it("refuses what it cannot read", () => {
    expect(connectionFromSync({ id: "x", data: { name: 1 } }, undefined)).toBeNull();
    expect(connectionFromSync({ id: "x", data: { name: "x" } }, undefined)).toBeNull();
  });
});

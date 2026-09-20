import { describe, expect, it } from "vitest";
import { call, type ErrorBody, login, newAccount, register, type Session, signedUp, verify } from "./client.js";

interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

const devices = (token: string) => call<{ devices: Device[] } & Partial<ErrorBody>>("/v1/devices", { token });

describe("devices", () => {
  it("lists the machine that signed in, and marks it as this one", async () => {
    const { session } = await signedUp("laptop");
    const result = await devices(session.accessToken);

    expect(result.status).toBe(200);
    const listed = result.body.devices.find((device) => device.id === session.deviceId);
    expect(listed).toBeDefined();
    expect(listed?.name).toBe("laptop");
    expect(listed?.current).toBe(true);
    expect(listed?.createdAt).toBeGreaterThan(0);
    expect(listed?.lastSeenAt).toBeGreaterThanOrEqual(listed?.createdAt ?? 0);
  });

  it("shows every machine to every machine", async () => {
    const account = newAccount();
    await register(account);
    await verify(account);
    const laptop = await login(account, "laptop");
    const desktop = await login(account, "desktop");

    const seen = (await devices(laptop.accessToken)).body.devices;
    expect(seen.map((device) => device.name).sort()).toEqual(["desktop", "laptop"]);
    expect(seen.find((device) => device.id === desktop.deviceId)?.current).toBe(false);
  });

  it("cuts off a lost machine by ending its refresh token", async () => {
    const account = newAccount();
    await register(account);
    await verify(account);
    const laptop = await login(account, "laptop");
    const lost = await login(account, "lost");

    const removed = await call(`/v1/devices/${lost.deviceId}`, {
      method: "DELETE",
      token: laptop.accessToken,
    });
    expect(removed.status).toBe(204);

    const refreshed = await call<Session & Partial<ErrorBody>>("/v1/auth/refresh", {
      body: { refreshToken: lost.refreshToken },
    });
    expect(refreshed.status).toBe(401);

    expect((await devices(laptop.accessToken)).body.devices.map((device) => device.id)).not.toContain(
      lost.deviceId,
    );
  });

  it("lets a machine remove itself, which is how a person signs out", async () => {
    const { session } = await signedUp();
    const removed = await call(`/v1/devices/${session.deviceId}`, {
      method: "DELETE",
      token: session.accessToken,
    });
    expect(removed.status).toBe(204);
  });

  it("refuses an id that is not a device of this account", async () => {
    // 404 and not 403: a 403 would confirm that the device exists on somebody else's account.
    const { session } = await signedUp();
    const other = await signedUp();
    const result = await call<ErrorBody>(`/v1/devices/${other.session.deviceId}`, {
      method: "DELETE",
      token: session.accessToken,
    });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("unknown-device");
  });
});

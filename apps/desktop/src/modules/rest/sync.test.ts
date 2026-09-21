import { describe, expect, it } from "vitest";
import { environmentFromSync, environmentToSync, requestFromSync, requestToSync } from "./sync";
import type { Environment } from "./environments";
import type { RestRequest } from "./types";

const request = {
  id: "r1",
  name: "List users",
  method: "GET",
  url: "https://api/users",
  params: [],
  headers: [],
  body: { kind: "none" },
  auth: { type: "bearer", token: "secret-token" },
  origin: "manual",
  createdAt: 1,
  lastUsedAt: 99,
} as unknown as RestRequest;

describe("a request in sync", () => {
  it("carries the request, not its credential and not when it was last sent", () => {
    const { data } = requestToSync(request);
    expect(JSON.stringify(data)).not.toContain("secret-token");
    expect(data).not.toHaveProperty("lastUsedAt");
    expect(data).toMatchObject({ name: "List users", url: "https://api/users", createdAt: 1 });
  });

  it("keeps this machine's credential and last use", () => {
    const { data } = requestToSync(request);
    const next = requestFromSync({ id: "r1", data: { ...(data as object), name: "Users" } }, request);
    expect(next?.name).toBe("Users");
    expect(next?.auth).toEqual(request.auth);
    expect(next?.lastUsedAt).toBe(99);
  });

  it("refuses what it cannot read", () => {
    expect(requestFromSync({ id: "x", data: { name: "x" } }, undefined)).toBeNull();
  });
});

const env: Environment = {
  id: "e1",
  name: "Staging",
  vars: [
    { name: "base", value: "https://staging", secret: false },
    { name: "token", value: "shh", secret: true },
  ],
};

describe("an environment in sync", () => {
  it("carries a value only when it is not secret", () => {
    const { data } = environmentToSync(env);
    expect(JSON.stringify(data)).not.toContain("shh");
    expect(JSON.stringify(data)).toContain("https://staging");
  });

  it("keeps this machine's secret values by name", () => {
    const { data } = environmentToSync(env);
    const next = environmentFromSync({ id: "e1", data }, env);
    expect(next?.vars).toEqual(env.vars);
  });

  it("arrives with an empty secret where this machine had none", () => {
    const { data } = environmentToSync(env);
    const next = environmentFromSync({ id: "e1", data }, undefined);
    expect(next?.vars.find((v) => v.name === "token")).toEqual({ name: "token", value: "", secret: true });
  });
});

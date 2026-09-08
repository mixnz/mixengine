import { describe, expect, it } from "vitest";
import type { Environment } from "./environments";
import { MIN_MATCH, findSubstitutions, substitute } from "./substitute";
import type { RestRequest } from "./types";

const row = (key: string, value: string, enabled = true) => ({ id: key, enabled, key, value });

function env(vars: { name: string; value: string; secret?: boolean }[]): Environment {
  return {
    id: "e1",
    name: "dev",
    vars: vars.map((v) => ({ name: v.name, value: v.value, secret: v.secret ?? false })),
  };
}

function request(patch: Partial<RestRequest> = {}): RestRequest {
  return {
    id: "r1",
    name: "",
    method: "GET",
    url: "https://api.dev/users",
    params: [],
    headers: [],
    body: { kind: "none" },
    auth: { kind: "none" },
    origin: "manual",
    createdAt: 0,
    lastUsedAt: 0,
    ...patch,
  };
}

describe("findSubstitutions", () => {
  it("finds a value in the url", () => {
    const found = findSubstitutions(request(), env([{ name: "host", value: "api.dev" }]));
    expect(found).toEqual([{ name: "host", value: "api.dev", secret: false, count: 1 }]);
  });

  it("finds nothing when no value is in the request", () => {
    expect(findSubstitutions(request(), env([{ name: "host", value: "api.prod" }]))).toEqual([]);
  });

  it("counts every place a value turns up", () => {
    const found = findSubstitutions(
      request({ headers: [row("Origin", "https://api.dev")] }),
      env([{ name: "host", value: "api.dev" }]),
    );
    expect(found[0].count).toBe(2);
  });

  it("marks a secret variable as one, so the caller can mask what it shows", () => {
    const found = findSubstitutions(
      request({ auth: { kind: "bearer", token: "s3cret-token" } }),
      env([{ name: "token", value: "s3cret-token", secret: true }]),
    );
    expect(found[0]).toMatchObject({ name: "token", secret: true, count: 1 });
  });

  // The longer variable reaches the characters first, so the shorter one no longer sees them and
  // the counts say what `substitute` will really do.
  it("gives overlapping characters to the longer value", () => {
    const found = findSubstitutions(
      request({ url: "https://api.example.com/v1" }),
      env([
        { name: "domain", value: "example.com" },
        { name: "host", value: "api.example.com" },
      ]),
    );
    expect(found).toEqual([{ name: "host", value: "api.example.com", secret: false, count: 1 }]);
  });

  it("ignores a value too short to be more than a coincidence", () => {
    const short = "x".repeat(MIN_MATCH - 1);
    const found = findSubstitutions(request({ url: `https://api.dev/${short}` }), env([{ name: "v", value: short }]));
    expect(found).toEqual([]);
  });

  it("ignores an unnamed row and the second of a repeated name", () => {
    const found = findSubstitutions(
      request(),
      env([
        { name: "", value: "api.dev" },
        { name: "host", value: "api.dev" },
        { name: "host", value: "users" },
      ]),
    );
    expect(found).toEqual([{ name: "host", value: "api.dev", secret: false, count: 1 }]);
  });

  it("leaves an unticked row alone and does not count what is in it", () => {
    const found = findSubstitutions(
      request({ url: "https://x/", headers: [row("Host", "api.dev", false)] }),
      env([{ name: "host", value: "api.dev" }]),
    );
    expect(found).toEqual([]);
  });

  // The one rule that has to hold whatever else changes: a path is a path on this machine.
  it("never reads a file path", () => {
    const found = findSubstitutions(
      request({
        url: "https://x/",
        body: {
          kind: "multipart",
          fields: [{ id: "f", enabled: true, key: "f", value: "", file: "C:/api.dev/a.png" }],
        },
      }),
      env([{ name: "host", value: "api.dev" }]),
    );
    expect(found).toEqual([]);
  });
});

describe("substitute", () => {
  it("writes the value back as its variable", () => {
    const out = substitute(request(), env([{ name: "host", value: "api.dev" }]));
    expect(out.url).toBe("https://{{host}}/users");
  });

  it("reaches both halves of a row, the body and the auth", () => {
    const out = substitute(
      request({
        url: "https://x/",
        params: [row("api.dev", "api.dev")],
        headers: [row("Origin", "https://api.dev")],
        body: { kind: "raw", language: "json", text: '{"h":"api.dev"}' },
        auth: { kind: "basic", username: "api.dev", password: "api.dev" },
      }),
      env([{ name: "host", value: "api.dev" }]),
    );
    expect(out.params[0]).toMatchObject({ key: "{{host}}", value: "{{host}}" });
    expect(out.headers[0].value).toBe("https://{{host}}");
    expect(out.body).toMatchObject({ text: '{"h":"{{host}}"}' });
    expect(out.auth).toMatchObject({ username: "{{host}}", password: "{{host}}" });
  });

  it("leaves a file path and an unticked row exactly as they were", () => {
    const original = request({
      url: "https://x/",
      headers: [row("Host", "api.dev", false)],
      body: {
        kind: "multipart",
        fields: [{ id: "f", enabled: true, key: "f", value: "", file: "C:/api.dev/a.png" }],
      },
    });
    const out = substitute(original, env([{ name: "host", value: "api.dev" }]));
    expect(out.headers[0].value).toBe("api.dev");
    expect(out.body).toMatchObject({ fields: [{ file: "C:/api.dev/a.png" }] });
  });

  it("keeps everything a request is besides its text", () => {
    const out = substitute(request({ id: "keep", name: "n", createdAt: 7 }), env([]));
    expect(out).toMatchObject({ id: "keep", name: "n", createdAt: 7, method: "GET" });
  });
});

import { describe, expect, it } from "vitest";
import { resolveRequest } from "./resolveRequest";
import type { RestRequest } from "./types";

const vars = { host: "api.dev", token: "t0k", user: "ann" };

const row = (key: string, value: string, enabled = true) => ({ id: key, enabled, key, value });

function request(patch: Partial<RestRequest> = {}): RestRequest {
  return {
    id: "r1",
    name: "",
    method: "GET",
    url: "https://{{host}}/users",
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

describe("resolveRequest", () => {
  // The whole of what "no environment" means, in one test.
  it("changes nothing when no environment is chosen", () => {
    const original = request({ headers: [row("X-{{host}}", "{{token}}")] });
    const out = resolveRequest(original, null);
    expect(out.request).toBe(original);
    expect(out.missing).toEqual([]);
    expect(out.cyclic).toBe(false);
  });

  it("resolves the url", () => {
    expect(resolveRequest(request(), vars).request.url).toBe("https://api.dev/users");
  });

  it("resolves both halves of a header row", () => {
    const out = resolveRequest(request({ headers: [row("X-{{host}}", "Bearer {{token}}")] }), vars);
    expect(out.request.headers[0]).toMatchObject({ key: "X-api.dev", value: "Bearer t0k" });
  });

  it("resolves both halves of a param row", () => {
    const out = resolveRequest(request({ params: [row("{{user}}_id", "{{token}}")] }), vars);
    expect(out.request.params[0]).toMatchObject({ key: "ann_id", value: "t0k" });
  });

  it("resolves a raw body", () => {
    const out = resolveRequest(
      request({ body: { kind: "raw", language: "json", text: '{"t":"{{token}}"}' } }),
      vars,
    );
    expect(out.request.body).toEqual({ kind: "raw", language: "json", text: '{"t":"t0k"}' });
  });

  it("resolves a form field", () => {
    const out = resolveRequest(
      request({ body: { kind: "form", fields: [row("u", "{{user}}")] } }),
      vars,
    );
    expect(out.request.body).toMatchObject({ fields: [{ key: "u", value: "ann" }] });
  });

  it("resolves every auth kind's fields", () => {
    expect(
      resolveRequest(request({ auth: { kind: "bearer", token: "{{token}}" } }), vars).request.auth,
    ).toEqual({ kind: "bearer", token: "t0k" });
    expect(
      resolveRequest(
        request({ auth: { kind: "basic", username: "{{user}}", password: "{{token}}" } }),
        vars,
      ).request.auth,
    ).toEqual({ kind: "basic", username: "ann", password: "t0k" });
    expect(
      resolveRequest(
        request({ auth: { kind: "apiKey", name: "{{user}}-key", value: "{{token}}", in: "query" } }),
        vars,
      ).request.auth,
    ).toEqual({ kind: "apiKey", name: "ann-key", value: "t0k", in: "query" });
  });

  // A path is a path on this machine. Nothing in it is a variable, whatever it looks like.
  it("never touches a file path", () => {
    const multipart = resolveRequest(
      request({
        body: { kind: "multipart", fields: [{ ...row("f", ""), file: "C:/{{host}}/a.png" }] },
      }),
      vars,
    );
    expect((multipart.request.body as { fields: { file?: string }[] }).fields[0].file).toBe(
      "C:/{{host}}/a.png",
    );

    const binary = resolveRequest(
      request({ body: { kind: "binary", filePath: "/tmp/{{host}}.bin" } }),
      vars,
    );
    expect(binary.request.body).toEqual({ kind: "binary", filePath: "/tmp/{{host}}.bin" });
  });

  // An unticked row is not sent, so what is in it is not a reason to stop a send. Parking a row is
  // how a request with a variable nobody has a value for is sent anyway.
  it("leaves an unticked row alone and does not count what is in it", () => {
    const out = resolveRequest(
      request({ url: "https://{{host}}", headers: [row("X-Off", "{{nope}}", false)] }),
      vars,
    );
    expect(out.request.headers[0].value).toBe("{{nope}}");
    expect(out.missing).toEqual([]);
  });

  it("collects what is missing across the whole request, each name once", () => {
    const out = resolveRequest(
      request({
        url: "https://{{gone}}",
        headers: [row("A", "{{other}}")],
        body: { kind: "raw", language: "text", text: "{{gone}}" },
      }),
      vars,
    );
    expect(out.missing).toEqual(["gone", "other"]);
  });

  it("reports a cycle found anywhere in the request", () => {
    const out = resolveRequest(request({ url: "{{loop}}" }), { loop: "{{loop}}" });
    expect(out.cyclic).toBe(true);
  });
});

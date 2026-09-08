import { describe, expect, it } from "vitest";
import { DEFAULT_SEND_SETTINGS, authOverride, buildRequest } from "./buildRequest";
import { newRequest } from "./requests";
import type { Body, KeyValue, RestRequest } from "./types";

function row(over: Partial<KeyValue> & { id: string }): KeyValue {
  return { enabled: true, key: "", value: "", ...over };
}

function request(over: Partial<RestRequest> = {}): RestRequest {
  return { ...newRequest("r", 0), url: "https://x.test/a", ...over };
}

const build = (over: Partial<RestRequest> = {}) =>
  buildRequest(request(over), "send-1", DEFAULT_SEND_SETTINGS);

/** The header's value, whatever case it was written in. */
function header(wire: ReturnType<typeof build>, name: string): string | undefined {
  return wire.headers.find(([key]) => key.toLowerCase() === name)?.[1];
}

describe("buildRequest: the envelope", () => {
  it("carries the id the caller will cancel by", () => {
    expect(build().request_id).toBe("send-1");
  });

  it("carries the method", () => {
    expect(build({ method: "DELETE" }).method).toBe("DELETE");
  });

  it("carries Phase 1's hardcoded send settings", () => {
    const wire = build();
    expect(wire.timeout_ms).toBe(30_000);
    expect(wire.follow_redirects).toBe(true);
    expect(wire.accept_invalid_certs).toBe(false);
  });

  it("folds the Params table into the URL", () => {
    const wire = build({ params: [row({ id: "a", key: "page", value: "2" })] });
    expect(wire.url).toBe("https://x.test/a?page=2");
  });

  it("leaves the unticked headers out", () => {
    const wire = build({
      headers: [row({ id: "a", enabled: false, key: "X-Debug", value: "1" })],
    });
    expect(wire.headers).toEqual([]);
  });

  it("leaves out the empty row at the foot of the table", () => {
    const wire = build({ headers: [row({ id: "a", key: "", value: "" })] });
    expect(wire.headers).toEqual([]);
  });

  it("keeps a header repeated twice, twice", () => {
    const wire = build({
      headers: [row({ id: "a", key: "Cookie", value: "x=1" }), row({ id: "b", key: "Cookie", value: "y=2" })],
    });
    expect(wire.headers).toEqual([["Cookie", "x=1"], ["Cookie", "y=2"]]);
  });
});

describe("buildRequest: bodies", () => {
  it("sends nothing, and declares nothing, for no body", () => {
    const wire = build();
    expect(wire.body).toEqual({ kind: "none" });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("sends a raw body as text", () => {
    const wire = build({ body: { kind: "raw", language: "json", text: '{"a":1}' } });
    expect(wire.body).toEqual({ kind: "text", text: '{"a":1}' });
  });

  it("declares a content type for each raw language", () => {
    const of = (language: "json" | "xml" | "yaml" | "text") =>
      header(build({ body: { kind: "raw", language, text: "x" } }), "content-type");
    expect(of("json")).toBe("application/json");
    expect(of("xml")).toBe("application/xml");
    expect(of("yaml")).toBe("application/yaml");
    expect(of("text")).toBe("text/plain");
  });

  // `html` was on the list once and is still in anyone's `rest-requests.json`. Their body is not
  // lost and is not sent bare: it goes as text.
  it("reads a language it no longer offers as plain text", () => {
    const body = { kind: "raw", language: "html", text: "<p>hi</p>" } as unknown as Body;
    expect(header(build({ body }), "content-type")).toBe("text/plain");
  });

  // A content type the user typed is the one they meant — a REST client that overrides it is
  // one you cannot use to reproduce a bug.
  it("does not override a content type the user set", () => {
    const wire = build({
      headers: [row({ id: "a", key: "content-type", value: "application/vnd.api+json" })],
      body: { kind: "raw", language: "json", text: "{}" },
    });
    expect(wire.headers.filter(([key]) => key.toLowerCase() === "content-type")).toHaveLength(1);
    expect(header(wire, "content-type")).toBe("application/vnd.api+json");
  });

  it("encodes a form body and declares it", () => {
    const wire = build({
      body: {
        kind: "form",
        fields: [row({ id: "a", key: "name", value: "a b" }), row({ id: "b", key: "x", value: "1" })],
      },
    });
    expect(wire.body).toEqual({ kind: "text", text: "name=a%20b&x=1" });
    expect(header(wire, "content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("leaves unticked form fields out", () => {
    const wire = build({
      body: { kind: "form", fields: [row({ id: "a", enabled: false, key: "x", value: "1" })] },
    });
    expect(wire.body).toEqual({ kind: "text", text: "" });
  });

  it("turns multipart fields into parts, text and file alike", () => {
    const wire = build({
      body: {
        kind: "multipart",
        fields: [
          row({ id: "a", key: "note", value: "hi" }),
          { ...row({ id: "b", key: "avatar" }), file: "C:/tmp/a.png" },
        ],
      },
    });
    expect(wire.body).toEqual({
      kind: "multipart",
      parts: [
        { name: "note", value: "hi", path: null },
        { name: "avatar", value: null, path: "C:/tmp/a.png" },
      ],
    });
  });

  // reqwest writes the boundary into the header itself, and a boundary guessed here would not
  // match the one it generates.
  it("declares nothing for multipart", () => {
    const wire = build({ body: { kind: "multipart", fields: [] } });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("leaves out a multipart row that says file and names none", () => {
    const body: Body = {
      kind: "multipart",
      fields: [
        { id: "f1", enabled: true, key: "name", value: "Ann" },
        { id: "f2", enabled: true, key: "avatar", value: "", file: "" },
      ],
    };
    const wire = build({ body });
    expect(wire.body).toEqual({
      kind: "multipart",
      parts: [{ name: "name", value: "Ann", path: null }],
    });
  });

  it("sends a binary body as a path for Rust to read", () => {
    const wire = build({ body: { kind: "binary", filePath: "C:/tmp/a.bin" } });
    expect(wire.body).toEqual({ kind: "file", path: "C:/tmp/a.bin" });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("sends a binary body as the file it names", () => {
    const wire = build({ body: { kind: "binary", filePath: "/tmp/a.bin" } });
    expect(wire.body).toEqual({ kind: "file", path: "/tmp/a.bin" });
  });

  // The body picker sits on File from the moment it is chosen, which is before there is a file.
  it("sends no body at all for a binary body with no file", () => {
    const wire = build({ body: { kind: "binary", filePath: "" } });
    expect(wire.body).toEqual({ kind: "none" });
  });
});

describe("buildRequest: auth", () => {
  it("sends a bearer token as an Authorization header", () => {
    expect(header(build({ auth: { kind: "bearer", token: "t0k" } }), "authorization")).toBe(
      "Bearer t0k",
    );
  });

  it("sends basic credentials base64-encoded", () => {
    const wire = build({ auth: { kind: "basic", username: "ann", password: "s3cret" } });
    expect(header(wire, "authorization")).toBe("Basic YW5uOnMzY3JldA==");
  });

  // btoa alone throws on anything outside Latin-1, and a password with an accent is a real one.
  it("encodes a non-Latin-1 password as UTF-8 bytes", () => {
    const wire = build({ auth: { kind: "basic", username: "ann", password: "pässwörd" } });
    expect(header(wire, "authorization")).toBe("Basic YW5uOnDDpHNzd8O2cmQ=");
  });

  it("sends an API key as the header it names", () => {
    const wire = build({
      auth: { kind: "apiKey", name: "X-Api-Key", value: "abc", in: "header" },
    });
    expect(header(wire, "x-api-key")).toBe("abc");
  });

  it("sends an API key as a query parameter, after the ones in the table", () => {
    const wire = build({
      params: [row({ id: "a", key: "page", value: "2" })],
      auth: { kind: "apiKey", name: "api_key", value: "a b", in: "query" },
    });
    expect(wire.url).toBe("https://x.test/a?page=2&api_key=a%20b");
  });

  it("sends nothing for an API key with no name", () => {
    const wire = build({ auth: { kind: "apiKey", name: "", value: "abc", in: "header" } });
    expect(wire.headers).toEqual([]);
    expect(wire.url).toBe("https://x.test/a");
  });

  it("leaves an Authorization header typed by hand alone", () => {
    const wire = build({
      headers: [row({ id: "a", key: "Authorization", value: "Bearer typed" })],
      auth: { kind: "bearer", token: "chosen" },
    });
    expect(wire.headers).toEqual([["Authorization", "Bearer typed"]]);
  });

  it("leaves a query parameter of the same name alone", () => {
    const wire = build({
      params: [row({ id: "a", key: "api_key", value: "typed" })],
      auth: { kind: "apiKey", name: "api_key", value: "chosen", in: "query" },
    });
    expect(wire.url).toBe("https://x.test/a?api_key=typed");
  });

  // An unticked row is one that was parked. It is not in the request, so it claims nothing.
  it("sends the chosen auth when the row claiming its name is unticked", () => {
    const wire = build({
      headers: [row({ id: "a", enabled: false, key: "Authorization", value: "Bearer typed" })],
      auth: { kind: "bearer", token: "chosen" },
    });
    expect(header(wire, "authorization")).toBe("Bearer chosen");
  });
});

describe("authOverride", () => {
  it("is null when there is no auth to override", () => {
    expect(authOverride({ kind: "none" }, [], [])).toBeNull();
  });

  it("names the header that won", () => {
    const headers = [row({ id: "a", key: "authorization", value: "Bearer typed" })];
    expect(authOverride({ kind: "bearer", token: "t" }, headers, [])).toBe("Authorization");
  });

  it("names the parameter that won", () => {
    const params = [row({ id: "a", key: "api_key", value: "typed" })];
    const auth = { kind: "apiKey", name: "api_key", value: "v", in: "query" } as const;
    expect(authOverride(auth, [], params)).toBe("api_key");
  });

  // Header names are case-insensitive; query keys are not.
  it("does not treat a parameter of another case as the same key", () => {
    const params = [row({ id: "a", key: "API_KEY", value: "typed" })];
    const auth = { kind: "apiKey", name: "api_key", value: "v", in: "query" } as const;
    expect(authOverride(auth, [], params)).toBeNull();
  });
});

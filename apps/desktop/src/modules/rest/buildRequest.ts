import { encodeComponent, urlWithParams } from "./syncUrlParams";
import { rawLanguage } from "./types";
import type {
  Auth,
  Body,
  KeyValue,
  RawLanguage,
  RestRequest,
  WireBody,
  WirePart,
  WireRequest,
} from "./types";

/**
 * The state of the request pane, turned into the one thing Rust is given.
 *
 * Everything Rust would otherwise have to decide is decided here, where it can be tested without
 * a server: which URL, which headers, how a form is encoded, what content type to declare.
 *
 * `interpolate` runs in front of this, so what arrives here has its variables already put in.
 */

export interface SendSettings {
  timeoutMs: number;
  followRedirects: boolean;
  acceptInvalidCerts: boolean;
}

/** What the workspace file starts from, and what `toCurl` builds with — a printed cURL command
 *  carries no timeout of its own, so the default is the honest thing to build it under. */
export const DEFAULT_SEND_SETTINGS: SendSettings = {
  timeoutMs: 30_000,
  followRedirects: true,
  acceptInvalidCerts: false,
};

const CONTENT_TYPE = "content-type";

const RAW_TYPES: Record<RawLanguage, string> = {
  json: "application/json",
  xml: "application/xml",
  // RFC 9512 registered this in 2024; `text/yaml` and `application/x-yaml` are what servers saw
  // before it, and both are still accepted by everything that accepts either.
  yaml: "application/yaml",
  text: "text/plain",
};

/** The rows that are actually sent: ticked, and with something in the key. */
function live<T extends KeyValue>(rows: T[]): T[] {
  return rows.filter((row) => row.enabled && row.key !== "");
}

/** Base64 of a UTF-8 string. `btoa` alone throws on anything outside Latin-1, and a password with
 *  an accent in it is a real password. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let latin1 = "";
  for (const byte of bytes) latin1 += String.fromCharCode(byte);
  return btoa(latin1);
}

/** The one place the chosen auth would put itself, or null when it would put nothing: no auth at
 *  all, or an API key with no name to send it under. */
function authSlot(auth: Auth): { in: "header" | "query"; name: string; value: string } | null {
  switch (auth.kind) {
    case "none":
      return null;
    case "bearer":
      return { in: "header", name: "Authorization", value: `Bearer ${auth.token}` };
    case "basic":
      return {
        in: "header",
        name: "Authorization",
        value: `Basic ${base64(`${auth.username}:${auth.password}`)}`,
      };
    case "apiKey":
      return auth.name === "" ? null : { in: auth.in, name: auth.name, value: auth.value };
  }
}

/**
 * The name of the ticked row that already claims where this auth would go, or null when none does.
 *
 * A header or a parameter written out in a table is the one part of a request its author can see,
 * so it wins — the same rule the body's `Content-Type` follows. The difference is that the Auth tab
 * can sit disagreeing with a table for a long time, which is why this is exported: the pane says
 * whose value is really being sent instead of leaving the two to differ in silence.
 */
export function authOverride(auth: Auth, headers: KeyValue[], params: KeyValue[]): string | null {
  const slot = authSlot(auth);
  if (slot === null) return null;
  // Header names are case-insensitive and query keys are not, so they are not compared the same way.
  const claimed = live(slot.in === "header" ? headers : params).some((row) =>
    slot.in === "header" ? row.key.toLowerCase() === slot.name.toLowerCase() : row.key === slot.name,
  );
  return claimed ? slot.name : null;
}

/** The body on the wire, and the content type it implies — null where the body implies none, or
 *  where reqwest writes the header itself. */
function wireBody(body: Body): { body: WireBody; contentType: string | null } {
  switch (body.kind) {
    case "none":
      return { body: { kind: "none" }, contentType: null };
    case "raw":
      return {
        body: { kind: "text", text: body.text },
        contentType: RAW_TYPES[rawLanguage(body.language)],
      };
    case "form":
      return {
        body: {
          kind: "text",
          text: live(body.fields)
            .map((field) => `${encodeComponent(field.key)}=${encodeComponent(field.value)}`)
            .join("&"),
        },
        contentType: "application/x-www-form-urlencoded",
      };
    case "multipart": {
      /* A row switched to File before a file was picked holds an empty path. It is dropped like an
         unticked one: handing Rust an empty path buys an error naming nothing, and the row is
         visibly unfinished in the table, which is a better place to notice. */
      const parts: WirePart[] = live(body.fields)
        .filter((field) => field.file !== "")
        .map((field) => ({
          name: field.key,
          value: field.file === undefined ? field.value : null,
          path: field.file ?? null,
        }));
      // No content type: the boundary is reqwest's to generate and to announce.
      return { body: { kind: "multipart", parts }, contentType: null };
    }
    case "binary":
      /* No default content type — a file's type is the user's to declare, and guessing it from an
         extension would be wrong at exactly the moment it mattered. An empty path is the picker
         sitting on File before a file was chosen, and sends nothing rather than an error. */
      return body.filePath === ""
        ? { body: { kind: "none" }, contentType: null }
        : { body: { kind: "file", path: body.filePath }, contentType: null };
  }
}

/** Everything Rust needs and nothing it has to work out. `requestId` is minted per send, not per
 *  request: sending the same request twice gives two things to cancel. */
export function buildRequest(
  request: RestRequest,
  requestId: string,
  settings: SendSettings,
): WireRequest {
  const { body, contentType } = wireBody(request.body);
  const headers: [string, string][] = live(request.headers).map((row) => [row.key, row.value]);
  const declared = headers.some(([key]) => key.toLowerCase() === CONTENT_TYPE);
  if (contentType !== null && !declared) headers.push(["Content-Type", contentType]);

  /* Auth goes on last, and only where nothing was typed by hand. The synthetic parameter row is
     never seen by the Params table — it exists for the length of this fold and no longer. */
  const carried =
    authOverride(request.auth, request.headers, request.params) === null
      ? authSlot(request.auth)
      : null;
  if (carried?.in === "header") headers.push([carried.name, carried.value]);
  const params =
    carried?.in === "query"
      ? [...request.params, { id: "auth", enabled: true, key: carried.name, value: carried.value }]
      : request.params;

  return {
    request_id: requestId,
    method: request.method,
    url: urlWithParams(request.url, params),
    headers,
    body,
    timeout_ms: settings.timeoutMs,
    follow_redirects: settings.followRedirects,
    accept_invalid_certs: settings.acceptInvalidCerts,
  };
}

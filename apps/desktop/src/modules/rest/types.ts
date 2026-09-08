/** The types the REST module is made of, and the ones it shares with Rust.
 *
 *  Nothing verifies that the wire types below still match `src-tauri/src/modules/rest/models.rs`
 *  — changing one means changing the other by hand. Fields stay snake_case on both sides because
 *  serde does not rename them. */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** In the order the dropdown offers them: the two everyone wants first. */
export const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** One row of the Params or Headers table. Unticked rows are kept and left out of the request —
 *  the only way to park a header without losing what was typed in it. */
export interface KeyValue {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
}

export type RawLanguage = "json" | "xml" | "yaml" | "text";

/** In the order the body picker offers them, after None. */
export const RAW_LANGUAGES: RawLanguage[] = ["json", "xml", "yaml", "text"];

/**
 * A stored language, read back safely.
 *
 * `rest-requests.json` was written by earlier versions of this module and holds whatever they
 * allowed — `html` among them. An unrecognised language is read as plain text rather than left to
 * fall through a lookup as `undefined`: the body is still the user's text, and sending it with no
 * content type at all would be a worse answer than sending it as text.
 */
export function rawLanguage(value: string): RawLanguage {
  return (RAW_LANGUAGES as string[]).includes(value) ? (value as RawLanguage) : "text";
}

/** A multipart field is a key/value row that may carry a file path instead of a value. */
export interface MultipartField extends KeyValue {
  file?: string;
}

export type Body =
  | { kind: "none" }
  | { kind: "raw"; language: RawLanguage; text: string }
  | { kind: "form"; fields: KeyValue[] }
  | { kind: "multipart"; fields: MultipartField[] }
  | { kind: "binary"; filePath: string };

export type Auth =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string }
  | { kind: "apiKey"; name: string; value: string; in: "header" | "query" };

export interface RestRequest {
  id: string;
  /** Empty means the sidebar shows a shortened URL instead. */
  name: string;
  method: Method;
  /** Kept with `{{var}}` in it; resolving happens on the way to the wire, from Phase 4. */
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
  origin: "manual" | "paste";
  createdAt: number;
  /** Stamped when Send is pressed, not when the tab is opened — see the spec's §5. */
  lastUsedAt: number;
}

/** The two groups of the sidebar, which is also the shape of `rest-requests.json`. */
export interface RequestLists {
  saved: RestRequest[];
  recent: RestRequest[];
}

/* ── The wire ── */

export type WireBody =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "file"; path: string }
  | { kind: "multipart"; parts: WirePart[] };

export interface WirePart {
  name: string;
  /** The field's text, for a plain part. */
  value: string | null;
  /** A file to send instead, read and streamed by Rust. */
  path: string | null;
}

export interface WireRequest {
  /** What `rest_cancel` names. Minted per send, not per request: two sends of the same request
   *  are two things to cancel. */
  request_id: string;
  method: Method;
  /** Final. Params are already folded in and, from Phase 4, variables already resolved. */
  url: string;
  /** A list rather than a map: `Set-Cookie` may repeat, and so may anything the user types twice. */
  headers: [string, string][];
  body: WireBody;
  timeout_ms: number;
  follow_redirects: boolean;
  accept_invalid_certs: boolean;
}

export interface RestResponse {
  status: number;
  status_text: string;
  http_version: string;
  headers: [string, string][];
  /** Base64 even for text: a response may be an image, a PDF or gzip, and Rust cannot assume
   *  UTF-8. The webview decodes to bytes and decides for itself whether they are readable. */
  body_base64: string;
  /** The real length, including whatever was cut. */
  body_size: number;
  truncated: boolean;
  final_url: string;
  total_ms: number;
  ttfb_ms: number;
}

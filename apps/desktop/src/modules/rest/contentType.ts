/**
 * What a response body is, and which of the three views it can be shown in.
 *
 * The fallback chain the spec asks for — no preview, fall to the tree; no tree, fall to raw — is
 * {@link availableModes} plus {@link pickMode}, two pure functions with tests, rather than
 * conditionals spread through the viewer.
 *
 * Nothing here touches `DOMParser`: the test run has no DOM, and this is the part that has to be
 * covered. Parsing a document into a tree happens in the component that draws it.
 */

export type BodyKind = "json" | "html" | "xml" | "text" | "image" | "pdf" | "binary";
export type ViewMode = "preview" | "source" | "raw";

export interface DetectedBody {
  kind: BodyKind;
  /** Lowercased, without its parameters. Empty when the response declared none. */
  mime: string;
  charset: string;
  /** The body as text, or null when it is not readable as any — which is what "binary" means. */
  text: string | null;
}

/** Past this the Source tree is not offered. The tree is not virtualised, and 2 MB of JSON is
 *  several hundred thousand nodes — building them all is how a webview stops answering. */
export const SOURCE_MAX_BYTES = 2 * 1024 * 1024;

/** The first value of a header, whatever case the server spelled the name in. */
export function headerValue(headers: [string, string][], name: string): string | null {
  const wanted = name.toLowerCase();
  const found = headers.find(([key]) => key.toLowerCase() === wanted);
  return found ? found[1] : null;
}

function parseContentType(raw: string | null): { mime: string; charset: string } {
  if (raw === null) return { mime: "", charset: "utf-8" };
  const [first, ...params] = raw.split(";");
  let charset = "utf-8";
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== "charset") continue;
    const value = param.slice(eq + 1).trim().replace(/^"|"$/g, "").toLowerCase();
    if (value !== "") charset = value;
  }
  return { mime: first.trim().toLowerCase(), charset };
}

/** What the declared type says this is, or null when it declared nothing. */
function kindFromMime(mime: string): BodyKind | null {
  if (mime === "") return null;
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "text/xml" || mime === "application/xml" || mime.endsWith("+xml")) return "xml";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return "binary";
}

/** The two types that mean "I did not look": one is the default for anything unknown, and the
 *  other is what half the world's JSON APIs send. Both are sniffed rather than believed. */
function isVague(mime: string): boolean {
  return mime === "application/octet-stream" || mime === "text/plain";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** The formats that announce themselves in their first few bytes. */
function sniffMagic(bytes: Uint8Array): BodyKind | null {
  if (startsWith(bytes, PNG) || startsWith(bytes, JPEG) || startsWith(bytes, GIF)) return "image";
  if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) return "image";
  if (startsWith(bytes, PDF)) return "pdf";
  return null;
}

/** The text, or null when these bytes are not text in that charset. `fatal` is the whole point:
 *  without it every byte sequence decodes, into replacement characters that look like a response.
 *  An unknown charset label is the server's mistake, not the body's, so utf-8 is tried after it. */
function decodeText(bytes: Uint8Array, charset: string): string | null {
  for (const label of charset === "utf-8" ? ["utf-8"] : [charset, "utf-8"]) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      // Either the label is not a charset or the bytes are not valid in it. Try the next.
    }
  }
  return null;
}

function sniffText(text: string): BodyKind | null {
  const head = text.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    try {
      JSON.parse(head);
      return "json";
    } catch {
      // Looks like JSON, is not. Fall through — it is text.
    }
  }
  if (/^<!doctype\s+html/i.test(head) || /^<html[\s>]/i.test(head)) return "html";
  if (head.startsWith("<?xml")) return "xml";
  return null;
}

/** What this body is. The declared type is believed unless it declared nothing or declared one of
 *  the two that mean nothing — see {@link isVague}. */
export function detectBody(headers: [string, string][], bytes: Uint8Array): DetectedBody {
  const { mime, charset } = parseContentType(headerValue(headers, "content-type"));
  const declared = kindFromMime(mime);

  if (declared !== null && !isVague(mime)) {
    if (declared === "image" || declared === "pdf" || declared === "binary") {
      return { kind: declared, mime, charset, text: null };
    }
    const text = decodeText(bytes, charset);
    if (text === null) return { kind: "binary", mime, charset, text: null };
    return { kind: declared, mime, charset, text };
  }

  const magic = sniffMagic(bytes);
  if (magic !== null) return { kind: magic, mime, charset, text: null };

  const text = decodeText(bytes, charset);
  if (text === null) return { kind: "binary", mime, charset, text: null };
  return { kind: sniffText(text) ?? "text", mime, charset, text };
}

/**
 * The views this body can be shown in, best first.
 *
 * Order is the fallback chain: preview, then the tree, then the raw bytes. Raw is always last and
 * always there, which is what makes {@link pickMode} total.
 */
export function availableModes(kind: BodyKind, byteLength: number): ViewMode[] {
  const modes: ViewMode[] = [];
  if (kind !== "xml" && kind !== "text") modes.push("preview");
  if ((kind === "json" || kind === "html" || kind === "xml") && byteLength <= SOURCE_MAX_BYTES) {
    modes.push("source");
  }
  modes.push("raw");
  return modes;
}

/**
 * Which view to show, given the one the user chose.
 *
 * The choice itself is never changed by this — the caller keeps it. So choosing Source and then
 * getting back an image shows the preview, and the next JSON response is a tree again.
 *
 * `available[0]` is always there: {@link availableModes} ends with `raw` for every kind.
 */
export function pickMode(preferred: ViewMode, available: ViewMode[]): ViewMode {
  return available.includes(preferred) ? preferred : available[0];
}

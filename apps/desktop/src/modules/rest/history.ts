import { resolveRequest } from "./resolveRequest";
import { urlWithParams } from "./syncUrlParams";
import type { Method, RestRequest } from "./types";

/**
 * What was sent, and what came back — the pure half of it.
 *
 * The file this shapes is read a week later by somebody asking why a call failed, which settles two
 * things about what may go in it. A **secret variable is left in its braces**: the entry says which
 * host and which path without saying what the token was. And a **body is kept whole or not at
 * all**, because half a JSON document answers nothing and `size` already says how big it really
 * was.
 */

export interface HistoryEntry {
  id: string;
  /** The request it was sent from. Never rewritten — a request deleted later is noticed when the
   *  entry is read, rather than by going back through the file. Null is tolerated on the way in,
   *  for a file written by a version that recorded a send with no request behind it. */
  requestId: string | null;
  /** The environment's name as it was then, so the entry still reads right after a rename. */
  envName: string;
  method: Method;
  /** Resolved, except for the variables marked secret. See {@link historyUrl}. */
  url: string;
  startedAt: number;
  durationMs: number;
  /** Null when no response arrived at all — a timeout, a refused connection, a rejected
   *  certificate. Those are answers, and they are what `error` is for. */
  status: number | null;
  statusText: string;
  /** The body's real length, including anything the 16 MB ceiling cut. */
  size: number;
  /** Already translated, the same way the response pane's banner is. */
  error: string | null;
  /** Base64, at most {@link BODY_MAX_BYTES}, and null whenever the switch is off. */
  responseBody: string | null;
}

/** How many sends are kept. A day's work several times over, and small enough that the file stays
 *  something the app reads once without thinking about it. */
export const MAX_ENTRIES = 100;

/** How big a body may be and still be worth keeping a hundred of. */
export const BODY_MAX_BYTES = 256 * 1024;

/**
 * The list with this send at the front.
 *
 * Nothing is collapsed. `queryHistory` folds a script run twice in a row into one entry because the
 * question was asked twice; a request sent twice is two answers, and the second one differing from
 * the first is usually why it was sent again.
 */
export function withEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...list].slice(0, MAX_ENTRIES);
}

export function withoutEntry(list: HistoryEntry[], id: string): HistoryEntry[] {
  return list.filter((entry) => entry.id !== id);
}

/** Every entry with its body forgotten. The same array when none had one, so turning the switch off
 *  where there was nothing to forget writes nothing. */
export function withoutBodies(list: HistoryEntry[]): HistoryEntry[] {
  if (!list.some((entry) => entry.responseBody !== null)) return list;
  return list.map((entry) =>
    entry.responseBody === null ? entry : { ...entry, responseBody: null },
  );
}

/** What goes in `responseBody`: the body, or nothing at all. */
export function keptBody(base64: string | null, size: number, keep: boolean): string | null {
  if (!keep || base64 === null || size > BODY_MAX_BYTES) return null;
  return base64;
}

/**
 * The URL as the file remembers it.
 *
 * Built from the request rather than from what was actually sent, and that is the point: the sent
 * URL carries the secrets, and the Auth tab's query key — a credential whether it came from a
 * variable or was typed in by hand — is folded in by `buildRequest` and so never reaches this
 * string.
 */
export function historyUrl(request: RestRequest, vars: Record<string, string> | null): string {
  const { request: resolved } = resolveRequest(request, vars);
  return urlWithParams(resolved.url, resolved.params);
}

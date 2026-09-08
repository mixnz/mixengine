import type { KeyValue } from "./types";

/**
 * The URL box and the Params table are two views of one thing.
 *
 * Written by hand rather than with `URL` and `URLSearchParams`, for two reasons that both matter:
 * the box holds text that is not a URL yet while it is being typed, and it holds `{{var}}`, which
 * `URLSearchParams` would percent-encode into something Phase 4 could no longer recognise.
 */

interface Parts {
  base: string;
  query: string;
  hash: string;
}

/** The URL cut into the three pieces this file cares about. The fragment comes off first: a `?`
 *  after a `#` is part of the fragment, not a query. */
function parts(url: string): Parts {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const rest = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = rest.indexOf("?");
  return {
    base: queryAt === -1 ? rest : rest.slice(0, queryAt),
    query: queryAt === -1 ? "" : rest.slice(queryAt + 1),
    hash,
  };
}

/** Decoded, with `+` read as the space a query string means by it. A stray `%` is what someone is
 *  halfway through typing, not a reason to throw. Exported because a pasted form body is decoded by
 *  the same rule, in `parsePaste`. */
export function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** Encoded, except for the braces of a variable — see the note at the top of the file. Exported
 *  because the form-urlencoded body is encoded by the same rule, in `buildRequest`. */
export function encodeComponent(text: string): string {
  return encodeURIComponent(text).replace(/%7B%7B/gi, "{{").replace(/%7D%7D/gi, "}}");
}

/**
 * The Params table for this URL, keeping as much of the table already there as the URL allows.
 *
 * Ticked rows are refilled from the query in order, so a row keeps its id — and so the table does
 * not rebuild itself under the cursor on every keystroke in the URL box. Unticked rows are not in
 * the URL at all, so they are passed over and kept exactly where they were.
 *
 * `nextId` supplies ids for rows the URL has and the table does not, which is what keeps this a
 * pure function.
 */
export function paramsFromUrl(url: string, existing: KeyValue[], nextId: () => string): KeyValue[] {
  const pairs = parts(url)
    .query.split("&")
    .filter((part) => part !== "")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return { key: decodeComponent(part), value: "" };
      return {
        key: decodeComponent(part.slice(0, eq)),
        value: decodeComponent(part.slice(eq + 1)),
      };
    });

  const rows: KeyValue[] = [];
  let taken = 0;
  for (const row of existing) {
    if (!row.enabled) {
      rows.push(row);
      continue;
    }
    const pair = pairs[taken];
    // The URL has fewer parameters than the table had ticked rows: the extra rows are gone.
    if (pair === undefined) continue;
    taken++;
    rows.push({ ...row, key: pair.key, value: pair.value });
  }
  for (const pair of pairs.slice(taken)) {
    rows.push({ id: nextId(), enabled: true, key: pair.key, value: pair.value });
  }
  return rows;
}

/** The URL with the ticked rows as its query. A row with no key is the empty one at the foot of
 *  the table waiting to be typed in, and belongs in no URL. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = parts(url);
  const query = params
    .filter((row) => row.enabled && row.key !== "")
    .map((row) => `${encodeComponent(row.key)}=${encodeComponent(row.value)}`)
    .join("&");
  return query === "" ? `${base}${hash}` : `${base}?${query}${hash}`;
}

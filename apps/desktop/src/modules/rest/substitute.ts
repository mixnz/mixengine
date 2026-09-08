import type { Environment } from "./environments";
import type { KeyValue, MultipartField, RestRequest } from "./types";

/**
 * The other direction from `resolveRequest`: a request that arrived carrying values, and an
 * environment that already has names for some of them.
 *
 * This is what a pasted cURL command is offered against. A command copied out of a browser or a
 * colleague's terminal has the host, the token and the api key written into it, and every one of
 * those is a thing the environment beside it exists to hold. Turning them back into `{{name}}` is
 * what makes the paste a request of this workspace rather than a snapshot of somebody else's.
 *
 * Nothing here decides to do it — `findSubstitutions` only says what could be swapped, so the
 * question can be put to the person who pasted. A value that looks like `{{host}}` may be the
 * whole point of the request they are about to send.
 *
 * The parts it reads and rewrites are exactly the parts `resolveRequest` resolves, and left out
 * for the same reasons: an unticked row is not sent, and a file path is a path on this machine.
 */

/** Shorter than this and a value matches by accident. `1`, `on`, `en` turn up inside a URL that
 *  has nothing to do with them, and an offer to replace one of those costs more attention than the
 *  replacement is worth. */
export const MIN_MATCH = 3;

export interface Substitution {
  name: string;
  /** What it matched on. A secret's is never drawn — the caller shows the mask instead. */
  value: string;
  secret: boolean;
  /** How many places in the request carry the value. */
  count: number;
}

/** The variables worth trying, longest value first. Length order is what stops a short value
 *  claiming characters inside a long one: `example.com` is inside `api.example.com`, and the
 *  variable naming more of the line is the one that should get it. */
function candidates(env: Environment): { name: string; value: string; secret: boolean }[] {
  const seen = new Set<string>();
  const out: { name: string; value: string; secret: boolean }[] = [];
  for (const v of env.vars) {
    // Same two rules `varMap` follows: an unnamed row is not a variable, and the first of a
    // repeated name is the one that counts.
    if (v.name === "" || seen.has(v.name)) continue;
    seen.add(v.name);
    if (v.value.length < MIN_MATCH) continue;
    out.push({ name: v.name, value: v.value, secret: v.secret });
  }
  return out.sort((a, b) => b.value.length - a.value.length);
}

/** Hands every piece of text a variable may stand in for to `take`, and builds the request back
 *  out of what comes back. */
function mapText(request: RestRequest, take: (text: string) => string): RestRequest {
  const row = <T extends KeyValue>(item: T): T =>
    item.enabled ? { ...item, key: take(item.key), value: take(item.value) } : item;

  const body = ((): RestRequest["body"] => {
    switch (request.body.kind) {
      case "none":
      case "binary":
        return request.body;
      case "raw":
        return { ...request.body, text: take(request.body.text) };
      case "form":
        return { ...request.body, fields: request.body.fields.map(row) };
      case "multipart":
        // `file` is left out of `row` by construction: it copies `key` and `value` and nothing else.
        return { ...request.body, fields: request.body.fields.map<MultipartField>(row) };
    }
  })();

  const auth = ((): RestRequest["auth"] => {
    switch (request.auth.kind) {
      case "none":
        return request.auth;
      case "bearer":
        return { ...request.auth, token: take(request.auth.token) };
      case "basic":
        return {
          ...request.auth,
          username: take(request.auth.username),
          password: take(request.auth.password),
        };
      case "apiKey":
        return { ...request.auth, name: take(request.auth.name), value: take(request.auth.value) };
    }
  })();

  return {
    ...request,
    url: take(request.url),
    params: request.params.map(row),
    headers: request.headers.map(row),
    body,
    auth,
  };
}

/**
 * What the environment could take over in this request, and how much of it.
 *
 * Counted against a copy that is rewritten as it goes, so two variables never both claim the same
 * characters — the longer one reaches them first and the shorter one no longer sees them. That is
 * also what makes the counts add up to what `substitute` will actually do.
 */
export function findSubstitutions(request: RestRequest, env: Environment): Substitution[] {
  let pieces: string[] = [];
  mapText(request, (text) => {
    pieces.push(text);
    return text;
  });

  const found: Substitution[] = [];
  for (const v of candidates(env)) {
    let count = 0;
    pieces = pieces.map((text) => {
      const parts = text.split(v.value);
      count += parts.length - 1;
      return parts.join(`{{${v.name}}}`);
    });
    if (count > 0) found.push({ name: v.name, value: v.value, secret: v.secret, count });
  }
  return found;
}

/** The request with every value `findSubstitutions` reported written back as `{{name}}`. */
export function substitute(request: RestRequest, env: Environment): RestRequest {
  const vars = candidates(env);
  return mapText(request, (text) => {
    let out = text;
    for (const v of vars) out = out.split(v.value).join(`{{${v.name}}}`);
    return out;
  });
}

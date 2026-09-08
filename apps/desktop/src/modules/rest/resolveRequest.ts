import { interpolate } from "./interpolate";
import type { KeyValue, MultipartField, RestRequest } from "./types";

/**
 * A request with its variables put in, on its way to `buildRequest`.
 *
 * **The copy this returns is never written back to the store.** It exists for the length of one
 * send. A request whose `{{token}}` had been replaced by a token is a request that has stopped
 * being portable — and, when the variable was a secret one, a request that has just written a
 * credential into `rest-requests.json`.
 *
 * Two things are deliberately left as they are. An **unticked row** is not sent, so it is not
 * resolved and what is in it is not a reason to stop a send — parking a row is how a request with
 * an unfilled variable goes out anyway. A **file path** is a path on this machine, and nothing in
 * it is a variable however much it looks like one.
 */

export interface ResolvedRequest {
  /** The request as it will be built. The same object when no environment is chosen. */
  request: RestRequest;
  /** Names the request asked for that the environment had no value for. Not empty means Send is
   *  off: a request carrying the literal text `{{token}}` in an Authorization header helps nobody. */
  missing: string[];
  /** A variable refers back to itself. Also stops the send, and says so in its own words. */
  cyclic: boolean;
}

export function resolveRequest(
  request: RestRequest,
  vars: Record<string, string> | null,
): ResolvedRequest {
  // No environment: the text travels as text, and nothing can be missing from a set nobody named.
  if (vars === null) return { request, missing: [], cyclic: false };

  // Bound to a const because a parameter's narrowing does not survive into a closure, and `take`
  // is one.
  const values = vars;
  const missing: string[] = [];
  let cyclic = false;

  function take(text: string): string {
    const out = interpolate(text, values);
    for (const name of out.missing) if (!missing.includes(name)) missing.push(name);
    cyclic = cyclic || out.cyclic;
    return out.text;
  }

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
    request: {
      ...request,
      url: take(request.url),
      params: request.params.map(row),
      headers: request.headers.map(row),
      body,
      auth,
    },
    missing,
    cyclic,
  };
}

// MixLab's sync server: the routes, and nothing that knows what a record is.
//
// The contract is normative in the design document, not here — D2 to D4a of
// docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md — and `server/conformance/` is
// written against that document rather than against this file. When the two disagree, this file is
// the one with the bug.

import { readConfig, type Capabilities, type Env } from "./config";
import { json, methodNotAllowed, misconfigured, notFound } from "./http";

export { Account } from "./account";

function capabilities(reported: Capabilities): Response {
  // Answered from configuration and never routed to an object. Routed to one, it would spend a
  // duration window every time a client said hello — and duration, not requests, is what runs out
  // first on the free plan (D8).
  return json(200, reported, { "Cache-Control": "public, max-age=3600" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = readConfig(env);
    if (!result.ok) return misconfigured(result.missing);

    const url = new URL(request.url);

    if (url.pathname === "/v1/capabilities") {
      return request.method === "GET" ? capabilities(result.config.capabilities) : methodNotAllowed();
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

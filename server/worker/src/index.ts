// MixLab's sync server: the routes, and nothing that knows what a record is.
//
// The contract is normative in the design document, not here — D2 to D4a of
// docs/specs/2026-09-20-t177-a-copy-only-you-can-read-design.md — and `server/conformance/` is
// written against that document rather than against this file. When the two disagree, this file is
// the one with the bug.
//
// **This file's only job is deciding which account object a request belongs to.** Everything that
// touches state happens inside that object, where execution is serialized. Two routes never reach
// one: `/v1/capabilities`, answered from configuration, and the verification page, which renders a
// form and validates nothing.

import { accountName } from "./crypto";
import { readConfig, type Capabilities, type Env } from "./config";
import { fail, json, methodNotAllowed, misconfigured, notFound } from "./http";
import { askSource } from "./ratelimit";
import { asObject, isEmail } from "./validate";

export { Account } from "./account";
export { SourceLimit } from "./ratelimit";

function capabilities(reported: Capabilities): Response {
  // Answered from configuration and never routed to an object. Routed to one, it would spend a
  // duration window every time a client said hello — and duration, not requests, is what runs out
  // first on the free plan (D8).
  return json(200, reported, { "Cache-Control": "public, max-age=3600" });
}

/**
 * The page the emailed link opens. **It does not spend the token**: mail scanners and link
 * previewers fetch every URL in a message, and a `GET` that verified would be spent before the
 * person read the letter — a bug that reads as "the link never works" and is nearly impossible to
 * reproduce. The button posts, and the post is what verifies (D4a).
 *
 * The one piece of HTML in this server, and it validates nothing, so it reaches no object.
 */
function verificationPage(email: string, token: string): Response {
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

  return new Response(
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirm your MixLab address</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         min-height: 100vh; background: #f6f7f9; color: #14161a; }
  main { background: #fff; padding: 2rem; border-radius: 12px; max-width: 26rem;
         box-shadow: 0 1px 3px rgb(0 0 0 / 12%); }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0 0 1.5rem; color: #4a5059; }
  button { font: inherit; padding: 0.6rem 1.2rem; border: 0; border-radius: 8px;
           background: #14161a; color: #fff; cursor: pointer; }
</style>
<main>
  <h1>Confirm your address</h1>
  <p>${escape(email)}</p>
  <form method="post" action="/v1/auth/verify" enctype="application/json">
    <button type="submit" id="confirm">Confirm</button>
  </form>
  <p id="done" hidden>Confirmed. You can sign in to MixLab now.</p>
</main>
<script type="module">
  const form = document.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch("/v1/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, token: ${JSON.stringify(token)} }),
    });
    form.hidden = true;
    const done = document.querySelector("#done");
    done.hidden = false;
    if (!response.ok) done.textContent = "That link is not usable. Ask MixLab for another.";
  });
</script>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** The object that holds an address. This is the whole of what replaces an index (D8). */
async function objectForEmail(env: Env, email: string): Promise<DurableObjectStub> {
  return env.ACCOUNT.get(env.ACCOUNT.idFromName(await accountName(email)));
}

/**
 * The object that issued a token. The name travels in the token's first half, so a bearer token
 * routes without a lookup; `idFromString` refuses anything this namespace did not mint, which is
 * what makes an attacker-supplied prefix a `401` rather than a new object.
 */
function objectForToken(env: Env, header: string | null): DurableObjectStub | null {
  if (!header?.startsWith("Bearer ")) return null;
  const [name] = header.slice("Bearer ".length).split(".");
  if (!name) return null;
  try {
    return env.ACCOUNT.get(env.ACCOUNT.idFromString(name));
  } catch {
    return null;
  }
}

/** Forward to the object with the body already read, since routing had to read it. */
function forward(stub: DurableObjectStub, request: Request, body: string | null): Promise<Response> {
  const headers = new Headers(request.headers);
  return stub.fetch(
    new Request(request.url, { method: request.method, headers, body: body ?? undefined }),
  );
}

const BY_EMAIL = new Set([
  "/v1/auth/register",
  "/v1/auth/verify",
  "/v1/auth/login",
  "/v1/auth/reset",
]);
const BY_TOKEN = new Set([
  "/v1/devices",
  "/v1/records",
  "/v1/records/batch",
  "/v1/auth/password",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = readConfig(env);
    if (!result.ok) return misconfigured(result.missing);
    const config = result.config;

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/v1/capabilities") {
      return request.method === "GET" ? capabilities(config.capabilities) : methodNotAllowed();
    }

    if (path === "/v1/auth/verify" && request.method === "GET") {
      const email = url.searchParams.get("email");
      const token = url.searchParams.get("token");
      if (!isEmail(email) || !token) return notFound();
      return verificationPage(email, token);
    }

    // Read once, here: routing needs the address out of the body, and a body can only be read
    // once. Everything downstream is handed the text.
    const body = request.method === "GET" || request.method === "DELETE" ? null : await request.text();

    if (path === "/__test__/outbox") {
      if (!config.testOutbox) return notFound();
      const email = url.searchParams.get("email");
      if (!isEmail(email)) return notFound();
      return forward(await objectForEmail(env, email), request, body);
    }

    if (BY_EMAIL.has(path)) {
      const fields = asObject(body === null ? null : safeParse(body));
      const email = fields?.["email"];
      if (!isEmail(email)) return fail(400, "invalid-request", "An address is required.");

      // The two routes that create work out of nothing are counted per source rather than per
      // account: they are abused by opening many accounts, which a counter kept inside one
      // account's object cannot see. `ratelimit.ts` has the argument.
      const askingForReset = path === "/v1/auth/reset" && fields?.["token"] === undefined;
      if (path === "/v1/auth/register" || askingForReset) {
        const allowance = askingForReset
          ? config.limits.resetsPerHour
          : config.limits.registrationsPerHour;
        const verdict = await askSource(env.SOURCE_LIMIT, request, path, allowance);
        if (!verdict.allowed) {
          return fail(429, "too-many-requests", "Too many requests from this address.", {}, {
            "Retry-After": String(verdict.retryAfter ?? 3600),
          });
        }
      }

      return forward(await objectForEmail(env, email), request, body);
    }

    if (path === "/v1/auth/refresh") {
      const refreshToken = asObject(body === null ? null : safeParse(body))?.["refreshToken"];
      const stub = objectForToken(env, typeof refreshToken === "string" ? `Bearer ${refreshToken}` : null);
      if (!stub) return fail(401, "invalid-token", "That token is not usable.");
      return forward(stub, request, body);
    }

    if (BY_TOKEN.has(path) || path.startsWith("/v1/devices/") || path.startsWith("/v1/records/")) {
      const stub = objectForToken(env, request.headers.get("Authorization"));
      if (!stub) return fail(401, "invalid-token", "That token is not usable.");
      return forward(stub, request, body);
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
